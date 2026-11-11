import { Mongoose, Types } from 'mongoose';
import { NotificationSchema } from './notification.schema';

describe('shared Notification schema', () => {
  const Model = new Mongoose().model('Notification', NotificationSchema);

  it("accepts the 'help-request' type used by the 30-day reminder", () => {
    const error = new Model({
      userId: new Types.ObjectId(),
      type: 'help-request',
      title: 't',
      message: 'm',
    }).validateSync();
    expect(error?.errors?.type).toBeUndefined();
  });

  it('still rejects unknown types', () => {
    const error = new Model({
      userId: new Types.ObjectId(),
      type: 'bogus',
      title: 't',
      message: 'm',
    }).validateSync();
    expect(error?.errors?.type).toBeDefined();
  });
});
