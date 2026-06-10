import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BuildingsService } from "./buildings.service";
import { BuildingsController } from "./buildings.controller";
import { Building, BuildingSchema } from "./schemas/building.schema";
import { User, UserSchema } from "../users/schemas/user.schema";
import { TenantProfile, TenantProfileSchema } from "../tenant-profiles/schemas/tenant-profile.schema";
import { Apartment, ApartmentSchema } from "../apartments/schemas/apartment.schema";
import { EmailModule } from "../../shared/services/email.module";
import { TwilioModule } from "../../shared/services/twilio.module";
import { ConceptsModule } from "../concepts/concepts.module";
import { MessagesModule } from "../messages/messages.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Building.name, schema: BuildingSchema },
      { name: User.name, schema: UserSchema },
      { name: TenantProfile.name, schema: TenantProfileSchema },
      { name: Apartment.name, schema: ApartmentSchema },
    ]),
    EmailModule,
    TwilioModule,
    ConceptsModule,
    MessagesModule,
  ],
  controllers: [BuildingsController],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
