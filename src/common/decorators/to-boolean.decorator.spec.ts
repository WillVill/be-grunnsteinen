import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { ToBoolean } from './to-boolean.decorator';
import { ApartmentQueryDto } from '../../modules/apartments/dto/apartment-query.dto';
import { BuildingQueryDto } from '../../modules/buildings/dto/building-query.dto';
import { UploadDocumentDto } from '../../modules/documents/dto/upload-document.dto';
import { EventQueryDto } from '../../modules/events/dto/event-query.dto';
import { GroupQueryDto } from '../../modules/groups/dto/group-query.dto';
import { PostQueryDto } from '../../modules/posts/dto/post-query.dto';
import { ResourceQueryDto } from '../../modules/resources/dto/resource-query.dto';
import { SharedItemQueryDto } from '../../modules/sharing/sharing.controller';
import { UserQueryDto } from '../../modules/users/dto/user-query.dto';

// sharing.controller pulls in S3Service, which imports the ESM-only `uuid`.
jest.mock('../../shared/services/s3.service', () => ({ S3Service: class S3Service {} }));

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

  // Every query-string and multipart boolean: both arrive as strings, so 'false' must stay false.
  // Regressions: isMember=false was read as true; an upload with isPublic='false' was published.
  it.each<[string, string, new () => object]>([
    ['ApartmentQueryDto', 'isActive', ApartmentQueryDto],
    ['BuildingQueryDto', 'isActive', BuildingQueryDto],
    ['EventQueryDto', 'participating', EventQueryDto],
    ['GroupQueryDto', 'isMember', GroupQueryDto],
    ['GroupQueryDto', 'isPrivate', GroupQueryDto],
    ['PostQueryDto', 'isPinned', PostQueryDto],
    ['PostQueryDto', 'fromBoard', PostQueryDto],
    ['PostQueryDto', 'excludeGroupPosts', PostQueryDto],
    ['ResourceQueryDto', 'isActive', ResourceQueryDto],
    ['SharedItemQueryDto', 'isAvailable', SharedItemQueryDto],
    ['UserQueryDto', 'isHelpfulNeighbor', UserQueryDto],
    ['UploadDocumentDto (multipart)', 'isConceptWide', UploadDocumentDto],
    ['UploadDocumentDto (multipart)', 'isPublic', UploadDocumentDto],
  ])('%s.%s reads "false" as false and "true" as true', (_name, field, cls) => {
    expect(toDto(cls, { [field]: 'false' })[field]).toBe(false);
    expect(toDto(cls, { [field]: 'true' })[field]).toBe(true);
  });
});
