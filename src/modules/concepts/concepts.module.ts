import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Concept, ConceptSchema } from "./schemas/concept.schema";
import { Building, BuildingSchema } from "../buildings/schemas/building.schema";
import { ConceptsService } from "./concepts.service";
import { ConceptsController } from "./concepts.controller";
import { S3Module } from "../../shared/services/s3.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Concept.name, schema: ConceptSchema },
      { name: Building.name, schema: BuildingSchema },
    ]),
    S3Module,
  ],
  controllers: [ConceptsController],
  providers: [ConceptsService],
  exports: [MongooseModule, ConceptsService],
})
export class ConceptsModule {}
