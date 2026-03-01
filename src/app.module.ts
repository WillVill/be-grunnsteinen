import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './config/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { ApartmentsModule } from './modules/apartments/apartments.module';
import { PostsModule } from './modules/posts/posts.module';
import { EventsModule } from './modules/events/events.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MessagesModule } from './modules/messages/messages.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { GroupsModule } from './modules/groups/groups.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { TenantProfilesModule } from './modules/tenant-profiles/tenant-profiles.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    // Throttler configuration - Global: 300 requests per minute per IP
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute
        limit: 300, // 300 requests per minute
      },
    ]),
    AuthModule,
    TasksModule,
    HealthModule,
    UsersModule,
    OrganizationsModule,
    BuildingsModule,
    ApartmentsModule,
    PostsModule,
    EventsModule,
    ResourcesModule,
    NotificationsModule,
    MessagesModule,
    SharingModule,
    BookingsModule,
    DocumentsModule,
    GroupsModule,
    InvitationsModule,
    TenantProfilesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global Throttler Guard - rate limiting applied to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global JWT Auth Guard - all routes protected by default
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global Roles Guard - checks @Roles() decorator
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
