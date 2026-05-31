import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DocumentFolder,
  DocumentFolderSchema,
} from './schemas/document-folder.schema';
import {
  Document as DocumentEntity,
  DocumentSchema,
} from '../documents/schemas/document.schema';
import { DocumentFoldersService } from './document-folders.service';
import { DocumentFoldersController } from './document-folders.controller';
import { ConceptsModule } from '../concepts/concepts.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentFolder.name, schema: DocumentFolderSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
    ]),
    ConceptsModule,
  ],
  controllers: [DocumentFoldersController],
  providers: [DocumentFoldersService],
  exports: [DocumentFoldersService, MongooseModule],
})
export class DocumentFoldersModule {}
