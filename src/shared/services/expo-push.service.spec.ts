import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExpoPushService, PushMessage } from './expo-push.service';

const makeMessages = (n: number): PushMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    to: `ExponentPushToken[${i}]`,
    title: 'Tittel',
    body: 'Tekst',
    data: { linkTo: '/posts/1' },
  }));

const okResponse = (count: number, overrides: Record<number, any> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: Array.from({ length: count }, (_, i) => overrides[i] ?? { status: 'ok', id: `t${i}` }),
  }),
});

describe('ExpoPushService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  let ticketModel: { insertMany: jest.Mock };

  const build = (accessToken?: string) =>
    new ExpoPushService(
      {
        get: jest.fn((key: string) => (key === 'expo.accessToken' ? accessToken : undefined)),
      } as unknown as ConfigService,
      ticketModel as any,
    );

  beforeEach(() => {
    ticketModel = { insertMany: jest.fn().mockResolvedValue([]) };
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts 250 messages in chunks of 100/100/50', async () => {
    fetchMock.mockImplementation(async (_url: string, init: any) =>
      okResponse(JSON.parse(init.body).length),
    );
    const result = await build().send(makeMessages(250));

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0].sound).toBe('default');
  });

  it('returns tokens reported as DeviceNotRegistered', async () => {
    const messages = makeMessages(3);
    fetchMock.mockResolvedValue(
      okResponse(3, {
        1: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        2: { status: 'error', details: { error: 'MessageTooBig' } },
      }),
    );
    expect(await build().send(messages)).toEqual([messages[1].to]);
  });

  it('resolves to [] when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(build().send(makeMessages(2))).resolves.toEqual([]);
  });

  it('makes no request for empty input', async () => {
    expect(await build().send([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Authorization only when accessToken is configured', async () => {
    fetchMock.mockResolvedValue(okResponse(1));
    await build().send(makeMessages(1));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');

    await build('secret').send(makeMessages(1));
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer secret');
  });

  it('stores the ticket id and token of every accepted message for the receipt check', async () => {
    const messages = makeMessages(3);
    fetchMock.mockResolvedValue(
      okResponse(3, { 1: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
    );
    await build().send(messages);

    expect(ticketModel.insertMany).toHaveBeenCalledWith(
      [
        { ticketId: 't0', token: messages[0].to },
        { ticketId: 't2', token: messages[2].to },
      ],
      { ordered: false },
    );
  });

  it('still returns dead tokens when storing tickets fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    ticketModel.insertMany.mockRejectedValue(new Error('db down'));
    const messages = makeMessages(2);
    fetchMock.mockResolvedValue(
      okResponse(2, { 0: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
    );
    await expect(build().send(messages)).resolves.toEqual([messages[0].to]);
    jest.restoreAllMocks();
  });
});
