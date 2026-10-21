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

describe('EmailService.sendContentReport', () => {
  let service: EmailService;
  const send = sgMail.send as unknown as jest.Mock;

  beforeEach(() => {
    send.mockReset().mockResolvedValue([{ statusCode: 202, headers: {} }]);
    const config = { get: (key: string) => (key === 'sendgrid.apiKey' ? 'SG.test' : 'x') } as unknown as ConfigService;
    service = new EmailService(config);
  });

  const report = {
    targetType: 'post',
    reason: 'harassment',
    excerpt: '<script>alert(1)</script>',
    details: 'a <b>detail</b>',
    webPath: '/posts/1',
  };

  it('escapes user strings and sends one message per recipient', async () => {
    await service.sendContentReport(
      [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      report,
      'Kari <i>Nordmann</i>',
    );
    expect(send).toHaveBeenCalledTimes(2);
    const html: string = send.mock.calls[0][0].html;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Kari &lt;i&gt;Nordmann&lt;/i&gt;');
    expect(send.mock.calls[0][0].subject).toBe('Rapportert innhold: Oppslag');
  });

  it('does not reject when a recipient fails', async () => {
    send.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([{ statusCode: 202, headers: {} }]);
    await expect(
      service.sendContentReport([{ email: 'a@example.com' }, { email: 'b@example.com' }], report, 'Kari'),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
