import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';

interface MongoError extends Error {
  code?: number;
  keyPattern?: Record<string, number>;
  keyValue?: Record<string, unknown>;
}

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse = this.buildErrorResponse(exception, request.url);

    this.logError(exception, errorResponse);

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private buildErrorResponse(exception: unknown, path: string): ErrorResponse {
    const timestamp = new Date().toISOString();

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: string | string[];
      let error: string;

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, unknown>;
        message = (res.message as string | string[]) || exception.message;
        error = (res.error as string) || this.getErrorName(status);
      } else {
        message = exceptionResponse as string;
        error = this.getErrorName(status);
      }

      return { statusCode: status, message, error, timestamp, path };
    }

    // Handle Mongoose validation errors
    if (exception instanceof MongooseError.ValidationError) {
      const messages = Object.values(exception.errors).map((err) => err.message);
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: messages,
        error: 'Validation Error',
        timestamp,
        path,
      };
    }

    // Handle Mongoose CastError (invalid ObjectId, etc.)
    // Don't expose the actual invalid value for security
    if (exception instanceof MongooseError.CastError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Invalid ${exception.kind} format`,
        error: 'Validation Error',
        timestamp,
        path,
      };
    }

    // Handle MongoDB duplicate key error
    // Don't expose the actual duplicate value for security
    const mongoError = exception as MongoError;
    if (mongoError?.code === 11000) {
      const field = Object.keys(mongoError.keyPattern || {})[0] || 'field';
      // Don't expose the actual value - just indicate which field has a duplicate
      return {
        statusCode: HttpStatus.CONFLICT,
        message: `A record with this ${field} already exists`,
        error: 'Duplicate Key Error',
        timestamp,
        path,
      };
    }

    // Handle unknown errors
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
      timestamp,
      path,
    };
  }

  private getErrorName(status: number): string {
    const errorNames: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
    };
    return errorNames[status] || 'Error';
  }

  private logError(exception: unknown, errorResponse: ErrorResponse): void {
    const { statusCode, path, message } = errorResponse;

    // Log full error details server-side, but don't expose to client
    if (statusCode >= 500) {
      // Log full error with stack trace server-side only
      this.logger.error(
        `[${statusCode}] ${path} - ${JSON.stringify(message)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (statusCode >= 400) {
      // Log client errors as warnings
      this.logger.warn(`[${statusCode}] ${path} - ${JSON.stringify(message)}`);
    }
  }
}

