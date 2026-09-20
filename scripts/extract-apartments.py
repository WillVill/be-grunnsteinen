#!/usr/bin/env python3
"""
Extract apartment rows from the customer's spreadsheets into scripts/data/apartments.json.

The six sheets are not uniform — column names, header offsets, unit-number formats and
room-count encodings all differ per building — so each one gets an explicit config below
rather than relying on guesswork.

Usage:
    python3 scripts/extract-apartments.py [--src DIR]

Then import with:
    yarn import:apartments --dry-run
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

import pandas as pd

# Values in "Antall rom" that mark a non-residential row (customer decision: not imported).
NON_RESIDENTIAL = re.compile(r"garasje|parkering", re.I)

ROOM_ENUM = {1: "1-room", 2: "2-room", 3: "3-room", 4: "4-room"}
FIVE_PLUS = "5+room"

# entrance is capped at 20 chars by CreateApartmentDto.
MAX_ENTRANCE = 20

BUILDINGS = [
    {
        "code": "hjemom-langenga",
        "file": "Leilighetsoversikt Hjemom Langenga AS.xlsx",
        "sheets": ["Grunnsteinen AS"],
        "header": 0,
        "address_col": "Leilighet adresse",
        "postal_col": "Leilighet postnummer",
        "city_col": "By",
    },
    {
        "code": "hjemom-bergerlokka",
        "file": "Leilighetsoversikt Hjemom Bergerløkka AS.xlsx",
        "sheets": ["Grunnsteinen AS"],
        "header": 0,
        "address_col": "Leilighet adresse",
        "postal_col": "Leilighet postnummer",
        "city_col": "By",
    },
    {
        "code": "hjemom-granstangen-park",
        "file": "Leilighetsoversikt Hjemom Granstangen Park AS.xlsx",
        "sheets": ["Hus 18", "Hus 19", "Hus 20", "Hus 21", "Hus 22"],
        "header": 0,
        "address_col": "Adresse",
        "postal_col": "Postnummer",
        "city_col": "By",
        # Unit numbers already embed a distinguishing prefix (e.g. "7B H0101"),
        # so no Hus prefix is needed — verified unique across all five sheets.
    },
    {
        "code": "leva-granstangen-park",
        "file": "Leilighetsoversikt Leva Granstangen Park AS.xlsx",
        "sheets": ["Leva Hus 16", "Leva Hus 17"],
        "header": 0,
        "address_col": "Adresse",  # empty in this file — entrance falls back to "Hus N"
        "postal_col": "Postnummer",
        "city_col": "By",
        # Both sheets number from H0201, producing 35 collisions. The Hus number is the
        # only disambiguating data in the file (Seksjonsnummer is also duplicated and
        # Adresse is empty), so it must be folded into unitNumber.
        "prefix_unit_with_hus": True,
    },
    {
        "code": "leva-bergerlokka",
        "file": "Boligvelger Leva Bergerløkka AS.xlsx",
        "sheets": ["Leva Hus 24"],
        "header": 0,
        "address_col": "Adresse",
        "postal_col": "Postnummer",
        "city_col": "By",
        # "Leilighetsnummer" is "Hus 24_24A-H0201"; the simplified column drops the
        # redundant "Hus 24_" prefix and is what residents actually see.
        "unit_col": "Forenklet leilighetsnummer",
    },
    {
        "code": "leva-jessheim-park",
        "file": "Leilighetsoversikt Jessheim Park.xlsx",
        "sheets": ["Ark1"],
        "header": 1,  # row 0 is blank, row 1 is the header, row 2 is a units row
        "address_col": "Adresse",
        "postal_col": "Postnummer",
        "city_col": "Sted",
        "numeric_rooms": True,  # "Antall rom" holds 2 / 3, not "2-roms"
    },
]


def norm_unit(value: str) -> str:
    """'H0 - 101' -> 'H0101', 'J0 101' -> 'J0101', '7B H0101' -> '7B H0101'."""
    s = str(value).strip()
    # Collapse the spaced/dashed bolignummer form without mangling genuine prefixes.
    s = re.sub(r"^([A-Z]\d)\s*-\s*(\d+)$", r"\1\2", s)
    s = re.sub(r"^([A-Z]\d)\s+(\d+)$", r"\1\2", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_floor(value):
    """Etasje is numeric except for 'U1' (underetasje), which maps to -1.

    floor is a number in the Apartment schema, so basement levels need a numeric
    stand-in. -1 is used rather than 0 because 0 would be indistinguishable from a
    ground floor. Returns None for anything else so it is never silently wrong.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    m = re.fullmatch(r"[Uu](\d+)", s)
    if m:
        return -int(m.group(1))
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def parse_rooms(value, numeric: bool):
    if numeric:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None
    m = re.match(r"\s*(\d+)", str(value))
    return int(m.group(1)) if m else None


def first_col(df, *names):
    for n in names:
        if n in df.columns:
            return n
    return None


def extract(cfg, src):
    path = os.path.join(src, cfg["file"])
    if not os.path.exists(path):
        raise SystemExit(f"missing source file: {path}")

    rows, skipped = [], Counter()
    for sheet in cfg["sheets"]:
        df = pd.read_excel(path, sheet_name=sheet, header=cfg["header"])
        df.columns = [str(c).strip() for c in df.columns]

        rooms_col = first_col(df, "Antall rom")
        unit_col = first_col(df, cfg.get("unit_col", ""), "Leilighetsnummer")
        addr_col = first_col(df, cfg["address_col"])
        size_col = first_col(df, "Størrelse")
        floor_col = first_col(df, "Etasje")
        hus_col = first_col(df, "Hus")
        if not (rooms_col and unit_col):
            raise SystemExit(f"{cfg['code']}/{sheet}: missing Antall rom or Leilighetsnummer")

        # Hus number from the column when present, else from the sheet name ("Leva Hus 16").
        m = re.search(r"(\d+)", sheet)
        sheet_hus = m.group(1) if m else None

        for _, r in df.iterrows():
            raw_rooms = r[rooms_col]
            if pd.isna(raw_rooms) or str(raw_rooms).strip() in ("", "#"):
                skipped["blank/units row"] += 1
                continue
            if NON_RESIDENTIAL.search(str(raw_rooms)):
                skipped["garage/parking"] += 1
                continue
            unit_raw = r[unit_col]
            if pd.isna(unit_raw) or str(unit_raw).strip() in ("", "#"):
                skipped["no unit number"] += 1
                continue

            rooms = parse_rooms(raw_rooms, cfg.get("numeric_rooms", False))
            if rooms is None:
                skipped[f"unparsable rooms: {raw_rooms!r}"] += 1
                continue

            hus = None
            if hus_col is not None and not pd.isna(r[hus_col]):
                hus = str(int(float(r[hus_col]))) if str(r[hus_col]).replace(".", "").isdigit() else str(r[hus_col]).strip()
            hus = hus or sheet_hus

            unit = norm_unit(unit_raw)
            if cfg.get("prefix_unit_with_hus") and hus:
                unit = f"{hus}-{unit}"

            addr = None if addr_col is None or pd.isna(r[addr_col]) else str(r[addr_col]).strip()
            # Strip the "- H0101" door suffix so entrance is the street address only.
            if addr:
                addr = re.sub(r"\s*-\s*[A-Z]\d{3,4}$", "", addr).strip()
            entrance = addr or (f"Hus {hus}" if hus else None)
            if entrance and len(entrance) > MAX_ENTRANCE:
                entrance = entrance[:MAX_ENTRANCE].strip()

            def num(col):
                if col is None or pd.isna(r[col]):
                    return None
                try:
                    return round(float(r[col]), 1)
                except (TypeError, ValueError):
                    return None

            size = num(size_col)
            floor = parse_floor(r[floor_col]) if floor_col is not None else None
            if floor is None and floor_col is not None and not pd.isna(r[floor_col]):
                skipped[f"unparsable floor: {r[floor_col]!r}"] += 1

            rows.append({
                "unitNumber": unit,
                "entrance": entrance,
                "floor": floor,
                "sizeSqm": size,
                "numberOfRooms": rooms,
                "apartmentType": ROOM_ENUM.get(rooms, FIVE_PLUS),
            })

    # unitNumber must be unique within a building — the DB enforces it, fail loudly here.
    dupes = {k: v for k, v in Counter(x["unitNumber"] for x in rows).items() if v > 1}
    if dupes:
        raise SystemExit(
            f"{cfg['code']}: {len(dupes)} duplicate unitNumber(s), e.g. {list(dupes)[:5]}"
        )

    first = pd.read_excel(path, sheet_name=cfg["sheets"][0], header=cfg["header"])
    first.columns = [str(c).strip() for c in first.columns]

    def building_field(colname):
        col = first_col(first, colname)
        if col is None:
            return None
        vals = [str(v).strip() for v in first[col].dropna() if str(v).strip() not in ("", "#")]
        if not vals:
            return None
        v = Counter(vals).most_common(1)[0][0]
        return str(int(float(v))) if re.fullmatch(r"\d+\.0", v) else v

    return {
        "buildingCode": cfg["code"],
        "source": cfg["file"],
        "city": building_field(cfg["city_col"]),
        "postalCode": building_field(cfg["postal_col"]),
        "apartments": rows,
    }, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.expanduser("~/Downloads"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "data", "apartments.json"))
    args = ap.parse_args()

    out, total = [], 0
    for cfg in BUILDINGS:
        data, skipped = extract(cfg, args.src)
        n = len(data["apartments"])
        total += n
        out.append(data)
        skip_txt = ", ".join(f"{v} {k}" for k, v in skipped.items()) or "none"
        print(f"{n:>4} units  {cfg['code']:<26} ({data['postalCode']} {data['city']})  skipped: {skip_txt}")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"\n{total} apartments across {len(out)} buildings -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
