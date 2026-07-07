import { Injectable, PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import type { DtoClass } from '../dto';

/**
 * 自定义校验管道
 *
 * 检测 controller 参数上的 class 类型标注是否有静态 `validate()` 方法，
 * 有则调用进行运行时校验。不通过抛 BadRequestException。
 * 不依赖 class-validator / class-transformer。
 */
@Injectable()
export class AppValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { metatype } = metadata;
    // 无类型标注或非 class 类型（string, number, boolean 等），跳过
    if (!metatype || !this.isDtoClass(metatype)) {
      return value;
    }
    const error = (metatype as unknown as DtoClass).validate(value);
    if (error) {
      throw new BadRequestException(error);
    }
    return value;
  }

  private isDtoClass(metatype: unknown): boolean {
    return typeof metatype === 'function' && 'validate' in metatype;
  }
}
