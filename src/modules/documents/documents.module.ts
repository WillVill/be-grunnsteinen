import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Document, DocumentSchema } from './schemas/document.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { S3Module } from '../../shared/services/s3.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    S3Module,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
