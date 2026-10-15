/**
 * Finish account deletions whose cascade did not complete.
 *
 * DELETE /users/me writes the tombstone first and then runs every cascade step
 * on its own; a step that fails is logged and the deletion stays pending
 * (`isDeleted: true`, no `deletionCompletedAt`). The deleted user can no longer
 * call the API, so this script re-runs the cascade for them.
 *
 * Usage:
 *   yarn ts-node scripts/complete-account-deletion.ts <userId>
 *   yarn ts-node scripts/complete-account-deletion.ts --pending
 *
 * Idempotent: every step skips what is already done. Only tombstoned users
 * (`isDeleted: true`) are touched; this never starts a new deletion.
 */

import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { AccountDeletionService } from '../src/modules/users/account-deletion.service';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';

async function main() {
  const pending = process.argv.includes('--pending');
  const userId = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!pending && !userId) {
    console.error('Usage: <userId> | --pending');
    process.exit(1);
  }
  if (userId && !Types.ObjectId.isValid(userId)) {
    console.error(`Not a valid user id: ${userId}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
  const deletion = app.get(AccountDeletionService);

  const users = await userModel
    .find(
      pending
        ? { isDeleted: true, deletionCompletedAt: null }
        : { _id: new Types.ObjectId(userId), isDeleted: true },
    )
    .select('_id organizationId')
    .lean()
    .exec();

  if (users.length === 0) {
    console.log(
      pending
        ? 'No pending account deletions.'
        : `No tombstoned user ${userId} (not found, or not deleted — this script never starts a deletion).`,
    );
    await app.close();
    return;
  }

  let incomplete = 0;
  for (const user of users) {
    const id = String(user._id);
    const summary = await deletion.deleteAccount(id, String(user.organizationId));
    if (!summary.completed) incomplete++;
    console.log(`${id}: ${summary.completed ? 'completed' : 'STILL INCOMPLETE'}`);
    console.log(JSON.stringify(summary, null, 2));
  }

  console.log(`\nDone. ${users.length - incomplete}/${users.length} completed.`);
  await app.close();
  if (incomplete > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
