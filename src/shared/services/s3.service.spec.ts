// uuid ships ESM only, which ts-jest can't load; the guard doesn't need it.
jest.mock('uuid', () => ({ v4: () => 'uuid' }));

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3Service, assertDeletablePrefix } from './s3.service';

describe('assertDeletablePrefix', () => {
  it.each([
    'public/avatars/507f1f77bcf86cd799439011/',
    'public/sharing/items/507f1f77bcf86cd799439011/',
  ])('accepts a scoped folder: %s', (prefix) => {
    expect(() => assertDeletablePrefix(prefix)).not.toThrow();
  });

  it.each([
    '',
    'public/',
    'public/avatars/',
    'public/avatars',
    'public/sharing/items/',
    'public/gallery/',
    'public/gallery/foo/',
    'private/documents/',
    'public/events/507f1f77bcf86cd799439011/',
    'public/avatars/507f1f77bcf86cd799439011',
    'public/avatars/../gallery/',
    'public/avatars/a/b/',
    'x/public/avatars/abc/',
  ])('refuses %j', (prefix) => {
    expect(() => assertDeletablePrefix(prefix)).toThrow(BadRequestException);
  });

  it('refuses a non-string', () => {
    expect(() => assertDeletablePrefix(undefined as unknown as string)).toThrow(
      BadRequestException,
    );
  });
});

describe('S3Service.deletePrefix', () => {
  function makeService() {
    const config = { get: jest.fn().mockReturnValue('x') } as unknown as ConfigService;
    const service = new S3Service(config);
    const send = jest.fn();
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = { send };
    return { service, send };
  }

  it('refuses a bad prefix without calling S3', async () => {
    const { service, send } = makeService();
    await expect(service.deletePrefix('public/avatars/')).rejects.toThrow(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('lists and deletes page by page', async () => {
    const { service, send } = makeService();
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'public/avatars/u1/a.png' }, { Key: 'public/avatars/u1/b.png' }],
        IsTruncated: true,
        NextContinuationToken: 't1',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Contents: [{ Key: 'public/avatars/u1/c.png' }], IsTruncated: false })
      .mockResolvedValueOnce({});

    await expect(service.deletePrefix('public/avatars/u1/')).resolves.toBe(3);

    const commands = send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(commands[0].input).toMatchObject({ Prefix: 'public/avatars/u1/', MaxKeys: 1000 });
    expect(commands[1]).toBeInstanceOf(DeleteObjectsCommand);
    expect(commands[1].input.Delete.Objects).toEqual([
      { Key: 'public/avatars/u1/a.png' },
      { Key: 'public/avatars/u1/b.png' },
    ]);
    expect(commands[2].input).toMatchObject({ ContinuationToken: 't1' });
    expect(commands[3].input.Delete.Objects).toEqual([{ Key: 'public/avatars/u1/c.png' }]);
  });

  it('is a no-op on an empty prefix', async () => {
    const { service, send } = makeService();
    send.mockResolvedValueOnce({ IsTruncated: false });
    await expect(service.deletePrefix('public/sharing/items/i1/')).resolves.toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('S3Service.keyFromUrl', () => {
  const service = new S3Service({ get: jest.fn().mockReturnValue('cdn.test') } as unknown as ConfigService);

  it('maps a CloudFront URL back to its public/ key', () => {
    expect(service.keyFromUrl('https://cdn.test/avatars/u1/a.png')).toBe('public/avatars/u1/a.png');
  });

  it('returns null for an empty or unparsable URL', () => {
    expect(service.keyFromUrl('')).toBeNull();
    expect(service.keyFromUrl('not a url')).toBeNull();
  });
});
