import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Resource, ResourceSchema } from '../resources/schemas/resource.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { NotificationModule } from '../../shared/services/notification.module';
import { EmailModule } from '../../shared/services/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Resource.name, schema: ResourceSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationModule,
    EmailModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
