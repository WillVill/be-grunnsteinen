import { Document, Types } from 'mongoose';

export interface BaseDocument extends Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

