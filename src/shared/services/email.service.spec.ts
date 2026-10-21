jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

import * as sgMail from '@sendgrid/mail';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService and deleted accounts', () => {
  let service: EmailService;
  const send = sgMail.send as unknown as jest.Mock;

  beforeEach(() => {
    send.mockReset().mockResolvedValue([{ statusCode: 202, headers: {} }]);
    const config = { get: (key: string) => (key === 'sendgrid.apiKey' ? 'SG.test' : 'x') } as unknown as ConfigService;
    service = new EmailService(config);
  });

  it.each([
    'deleted+507f1f77bcf86cd799439011@deleted.invalid',
    'DELETED+507f1f77bcf86cd799439011@Deleted.Invalid',
  ])('never sends to a tombstone address: %s', async (to) => {
    await service.sendEmail(to, 'S', '<p>x</p>');
    await service.sendTemplateEmail(to, 'tpl', {});
    expect(send).not.toHaveBeenCalled();
  });

  it('still sends to a real address', async () => {
    await service.sendEmail('kari@example.com', 'S', '<p>x</p>');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
