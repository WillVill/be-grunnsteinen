import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushReceiptsService, RECEIPT_DELAY_MS } from './push-receipts.service';

describe('PushReceiptsService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let ticketModel: { find: jest.Mock; deleteMany: jest.Mock };
  let userModel: { updateMany: jest.Mock };
  let due: { ticketId: string; token: string }[];
  let findFilter: any;

  const chain = () => {
    const q: any = {};
    q.sort = jest.fn(() => q);
    q.limit = jest.fn(() => q);
    q.lean = jest.fn(() => q);
    q.exec = jest.fn(async () => due);
    return q;
  };

  const build = (accessToken?: string) =>
    new PushReceiptsService(
      { get: jest.fn((k: string) => (k === 'expo.accessToken' ? accessToken : undefined)) } as unknown as ConfigService,
      ticketModel as any,
      userModel as any,
    );

  const receipts = (data: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ data }) });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    due = [];
    ticketModel = {
      find: jest.fn((filter) => {
        findFilter = filter;
        return chain();
      }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    };
    userModel = { updateMany: jest.fn().mockResolvedValue({}) };
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('only looks at tickets older than the receipt delay', async () => {
    const before = Date.now();
    await build().checkReceipts();
    const cutoff: Date = findFilter.createdAt.$lte;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(RECEIPT_DELAY_MS - 1000);
    expect(RECEIPT_DELAY_MS).toBe(15 * 60 * 1000);
  });

  it('makes no request when no ticket is due', async () => {
    await build().checkReceipts();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ticketModel.deleteMany).not.toHaveBeenCalled();
  });

  it('prunes tokens whose receipt says DeviceNotRegistered and drops every ticket that got a receipt', async () => {
    due = [
      { ticketId: 'a', token: 'ExponentPushToken[a]' },
      { ticketId: 'b', token: 'ExponentPushToken[b]' },
      { ticketId: 'c', token: 'ExponentPushToken[c]' },
      { ticketId: 'd', token: 'ExponentPushToken[d]' },
    ];
    fetchMock.mockResolvedValue(
      receipts({
        a: { status: 'ok' },
        b: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        c: { status: 'error', details: { error: 'MessageRateExceeded' } },
        // d: no receipt yet — keep it for the next run
      }),
    );

    await build().checkReceipts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ids: ['a', 'b', 'c', 'd'] });
    expect(userModel.updateMany).toHaveBeenCalledWith(
      { pushTokens: { $in: ['ExponentPushToken[b]'] } },
      { $pull: { pushTokens: { $in: ['ExponentPushToken[b]'] } } },
    );
    expect(ticketModel.deleteMany).toHaveBeenCalledWith({ ticketId: { $in: ['a', 'b', 'c'] } });
  });

  it('does not touch users when no receipt reports a dead device', async () => {
    due = [{ ticketId: 'a', token: 'ExponentPushToken[a]' }];
    fetchMock.mockResolvedValue(receipts({ a: { status: 'ok' } }));
    await build().checkReceipts();
    expect(userModel.updateMany).not.toHaveBeenCalled();
    expect(ticketModel.deleteMany).toHaveBeenCalledWith({ ticketId: { $in: ['a'] } });
  });

  it('keeps the tickets and never rejects when Expo fails', async () => {
    due = [{ ticketId: 'a', token: 'ExponentPushToken[a]' }];
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(build().checkReceipts()).resolves.toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(build().checkReceipts()).resolves.toBeUndefined();
    expect(ticketModel.deleteMany).not.toHaveBeenCalled();
    expect(userModel.updateMany).not.toHaveBeenCalled();
  });

  it('sends Authorization only when an access token is configured', async () => {
    due = [{ ticketId: 'a', token: 'ExponentPushToken[a]' }];
    fetchMock.mockResolvedValue(receipts({}));
    await build().checkReceipts();
    await build('secret').checkReceipts();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer secret');
  });
});
