import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Resource, ResourceSchema } from './schemas/resource.schema';
import { ResourcesService } from './resources.service';
import { ResourcesController } from './resources.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Resource.name, schema: ResourceSchema },
    ]),
  ],
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}

