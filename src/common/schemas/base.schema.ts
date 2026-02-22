import { SchemaOptions } from '@nestjs/mongoose';

export const baseSchemaOptions: SchemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret: any) => {
      ret.id = ret._id.toString();
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
  },
};

