import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/** Express Response 最小类型定义 */
interface ExpressResponse {
  status(code: number): { json(body: unknown): void };
  json(body: unknown): void;
}
interface ExpressRequest {
  method: string;
  url: string;
}

/**
 * 全局异常过滤器
 *
 * - HttpException → 提取 status + message，统一返回 { code, data, message, timestamp }
 * - 未知 Error → 返回 500，message 固定为 'Internal Server Error'，防止信息泄漏
 * - 响应格式与 ResponseInterceptor 的成功响应对应（code=0 表示成功，code>0 表示失败）
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<ExpressResponse>();
    const request = ctx.getRequest<ExpressRequest>();

    let status: number;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'object' && exResponse !== null) {
        const resp = exResponse as { message?: string | string[]; error?: string };
        message = Array.isArray(resp.message)
          ? resp.message.join('; ')
          : (resp.message || exception.message);
      } else if (typeof exResponse === 'string') {
        message = exResponse;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal Server Error';
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal Server Error';
      this.logger.error(
        `Unknown error type: ${String(exception)}`,
        undefined,
        `${request.method} ${request.url}`,
      );
    }

    response.status(status).json({
      code: status,
      data: null,
      message,
      timestamp: Date.now(),
    });
  }
}
