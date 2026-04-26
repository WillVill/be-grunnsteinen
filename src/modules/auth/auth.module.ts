import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { TenantProfilesModule } from '../tenant-profiles/tenant-profiles.module';
import { Apartment, ApartmentSchema } from '../apartments/schemas/apartment.schema';
import { Building, BuildingSchema } from '../buildings/schemas/building.schema';
import { EmailModule } from '../../shared/services/email.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: (configService.get<string>('jwt.expiration') || '7d') as StringValue,
        },
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: Apartment.name, schema: ApartmentSchema },
      { name: Building.name, schema: BuildingSchema },
    ]),
    UsersModule,
    OrganizationsModule,
    InvitationsModule,
    TenantProfilesModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}

