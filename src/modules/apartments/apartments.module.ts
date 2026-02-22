import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ApartmentsService } from "./apartments.service";
import { ApartmentsController } from "./apartments.controller";
import { Apartment, ApartmentSchema } from "./schemas/apartment.schema";
import { Building, BuildingSchema } from "../buildings/schemas/building.schema";
import { User, UserSchema } from "../users/schemas/user.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Apartment.name, schema: ApartmentSchema },
      { name: Building.name, schema: BuildingSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ApartmentsController],
  providers: [ApartmentsService],
  exports: [ApartmentsService],
})
export class ApartmentsModule {}
