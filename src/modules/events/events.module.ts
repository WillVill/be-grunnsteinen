import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Event, EventSchema } from "./schemas/event.schema";
import { User, UserSchema } from "../users/schemas/user.schema";
import { Group, GroupSchema } from "../groups/schemas/group.schema";
import { EventsService } from "./events.service";
import { EventsController } from "./events.controller";
import { NotificationModule } from "../../shared/services/notification.module";
import { EmailModule } from "../../shared/services/email.module";
import { S3Module } from "../../shared/services/s3.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: User.name, schema: UserSchema },
      { name: Group.name, schema: GroupSchema },
    ]),
    NotificationModule,
    EmailModule,
    S3Module,
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
