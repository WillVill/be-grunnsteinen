import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CompleteSetupDto,
} from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ThrottleAuth } from '../../common/decorators/throttle-auth.decorator';

@ApiTags('Auth')
@Controller('auth')
@ThrottleAuth() // Apply 5 requests per minute to all auth endpoints
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered',
    schema: {
      properties: {
        user: { type: 'object' },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid organization code' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      properties: {
        user: { type: 'object' },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed successfully',
    schema: {
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({
    status: 200,
    description: 'Reset email sent if account exists',
    schema: {
      properties: {
        message: { type: 'string', example: 'If email exists, reset link sent' },
      },
    },
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.authService.forgotPassword(forgotPasswordDto);
    return { message: 'If email exists, reset link sent' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiResponse({
    status: 200,
    description: 'Password reset successful',
    schema: {
      properties: {
        message: { type: 'string', example: 'Password reset successful' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired reset token' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    await this.authService.resetPassword(resetPasswordDto);
    return { message: 'Password reset successful' };
  }

  @Public()
  @Get('validate-setup-token/:token')
  @ApiOperation({ summary: 'Validate an admin setup token' })
  @ApiResponse({
    status: 200,
    description: 'Token is valid',
    schema: {
      properties: {
        email: { type: 'string' },
        role: { type: 'string' },
        organizationName: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired setup link' })
  async validateSetupToken(@Param('token') token: string) {
    return this.authService.validateSetupToken(token);
  }

  @Public()
  @Post('complete-setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete admin setup, activate account, and return login tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Setup completed and user logged in',
    schema: {
      properties: {
        user: { type: 'object' },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired setup link' })
  async completeSetup(@Body() dto: CompleteSetupDto) {
    return this.authService.completeSetup(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change password for authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
    schema: {
      properties: {
        message: { type: 'string', example: 'Password changed' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async changePassword(
    @CurrentUser('userId') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(userId, changePasswordDto);
    return { message: 'Password changed' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout current user' })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
    schema: {
      properties: {
        message: { type: 'string', example: 'Logged out' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@CurrentUser() user: CurrentUserData) {
    // In a more complete implementation, you could:
    // - Add the token to a blacklist
    // - Clear refresh tokens from database
    // - Invalidate all sessions for the user
    return { message: 'Logged out' };
  }
}

