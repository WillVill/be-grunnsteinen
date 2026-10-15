import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { ToBoolean } from './to-boolean.decorator';
import { GroupQueryDto } from '../../modules/groups/dto/group-query.dto';

class SampleQueryDto {
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  flag?: boolean;
}

// Same options as the global ValidationPipe in main.ts.
const toDto = <T>(cls: new () => T, plain: object) => plainToInstance(cls, plain, { enableImplicitConversion: true });

describe('ToBoolean', () => {
  it('reads "false" as false despite implicit conversion', () => {
    expect(toDto(SampleQueryDto, { flag: 'false' }).flag).toBe(false);
  });

  it('reads "true" as true', () => {
    expect(toDto(SampleQueryDto, { flag: 'true' }).flag).toBe(true);
  });

  it('keeps real booleans and an absent value', () => {
    expect(toDto(SampleQueryDto, { flag: false }).flag).toBe(false);
    expect(toDto(SampleQueryDto, { flag: true }).flag).toBe(true);
    expect(toDto(SampleQueryDto, {}).flag).toBeUndefined();
  });

  it('passes other values through so @IsBoolean rejects them', () => {
    const dto = toDto(SampleQueryDto, { flag: 'yes' });
    expect(dto.flag).toBe('yes');
    expect(validateSync(dto)).toHaveLength(1);
  });

  it('is applied to the real query DTOs (regression: isMember=false was read as true)', () => {
    const dto = toDto(GroupQueryDto, { isMember: 'false', isPrivate: 'false' });
    expect(dto.isMember).toBe(false);
    expect(dto.isPrivate).toBe(false);
  });
});
