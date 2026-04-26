export interface EmailLayoutContext {
  frontendUrl: string;
  userId?: string;
  preheader?: string;
}

const BRAND_NAME = "Grunnsteinen";
const BRAND_TAGLINE = "Nabolagsplattform";
const ACCENT_COLOR = "#2563eb";
const PAGE_BG = "#f5f5f5";
const CARD_BG = "#ffffff";
const TEXT_COLOR = "#333333";
const MUTED_COLOR = "#6b7280";
const DIVIDER_COLOR = "#e5e7eb";
const HEADING_COLOR = "#111827";

export function renderEmailLayout(
  contentHtml: string,
  ctx: EmailLayoutContext,
): string {
  const year = new Date().getFullYear();
  const preheaderHtml = ctx.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE_BG};opacity:0;">${escapeHtml(ctx.preheader)}</div>`
    : "";

  const preferencesLink = ctx.userId
    ? `<a href="${ctx.frontendUrl}/settings/notifications?user=${ctx.userId}" style="color:${MUTED_COLOR};text-decoration:underline;">Administrer varslinger</a> &middot; `
    : "";

  return `<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${BRAND_NAME}</title>
  <style>
    @media (max-width: 600px) {
      .gs-card { padding: 28px 20px !important; }
      .gs-h1 { font-size: 22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}" style="background-color:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:600px;background-color:${CARD_BG};border-radius:10px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06);">
          <tr>
            <td style="height:6px;background-color:${ACCENT_COLOR};line-height:6px;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="gs-card" style="padding:36px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${TEXT_COLOR};line-height:1.6;">
              <div style="text-align:center;margin-bottom:28px;">
                <div style="font-size:26px;font-weight:700;letter-spacing:0.5px;color:${HEADING_COLOR};">${BRAND_NAME}</div>
                <div style="font-size:12px;color:${MUTED_COLOR};margin-top:4px;text-transform:uppercase;letter-spacing:1px;">${BRAND_TAGLINE}</div>
                <div style="height:1px;background-color:${DIVIDER_COLOR};margin-top:20px;"></div>
              </div>
              <div style="font-size:16px;color:${TEXT_COLOR};">
                ${contentHtml}
              </div>
              <div style="margin-top:36px;padding-top:20px;border-top:1px solid ${DIVIDER_COLOR};text-align:center;font-size:11px;color:${MUTED_COLOR};line-height:1.6;">
                <div>&copy; ${year} ${BRAND_NAME}. Alle rettigheter forbeholdt.</div>
                <div style="margin-top:6px;">
                  ${preferencesLink}<a href="${ctx.frontendUrl}" style="color:${MUTED_COLOR};text-decoration:underline;">Bes&oslash;k ${BRAND_NAME}</a>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderButton(label: string, href: string): string {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${href}" style="display:inline-block;background-color:${ACCENT_COLOR};color:#ffffff !important;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;box-shadow:0 2px 4px rgba(37,99,235,0.2);">${label}</a>
  </div>`;
}

export function renderInfoBox(rowsHtml: string): string {
  return `<div style="background-color:#f8fafc;border-left:3px solid ${ACCENT_COLOR};border-radius:6px;padding:18px 20px;margin:20px 0;">
    ${rowsHtml}
  </div>`;
}

export function renderH1(text: string): string {
  return `<h1 class="gs-h1" style="color:${HEADING_COLOR};font-size:26px;margin:0 0 20px 0;text-align:center;font-weight:700;">${text}</h1>`;
}

export function renderLinkFallback(href: string): string {
  return `<p style="font-size:12px;color:${MUTED_COLOR};margin-top:24px;">
    Hvis knappen ikke fungerer, kopier og lim inn denne lenken i nettleseren din:<br>
    <a href="${href}" style="color:${ACCENT_COLOR};word-break:break-all;">${href}</a>
  </p>`;
}
