import { Model, Types } from "mongoose";

/** Ids the user has blocked, as ObjectIds for $nin filters. Empty when none. */
export async function getBlockedIds(userModel: Model<any>, userId: string): Promise<Types.ObjectId[]> {
  const user = await userModel.findById(userId).select("+blockedUserIds").lean().exec();
  return (user?.blockedUserIds ?? []).map((id: unknown) => new Types.ObjectId(String(id)));
}

/** True when either user has blocked the other. */
export async function isBlockedEitherWay(userModel: Model<any>, a: string, b: string): Promise<boolean> {
  const count = await userModel.countDocuments({
    $or: [
      { _id: new Types.ObjectId(a), blockedUserIds: new Types.ObjectId(b) },
      { _id: new Types.ObjectId(b), blockedUserIds: new Types.ObjectId(a) },
    ],
  });
  return count > 0;
}
