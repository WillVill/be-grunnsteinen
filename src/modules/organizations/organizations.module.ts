import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organization, OrganizationSchema } from './schemas/organization.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { S3Module } from '../../shared/services/s3.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    S3Module,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [MongooseModule, OrganizationsService],
})
export class OrganizationsModule {}

