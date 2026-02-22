import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { TokenPayload } from '../auth.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: TokenPayload): Promise<any> {
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
      refreshToken,
    };
  }
}

