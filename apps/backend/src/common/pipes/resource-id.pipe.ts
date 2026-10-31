import { BadRequestException, type PipeTransform } from "@nestjs/common";

/** Rejects path parameters that do not match the identifier shape before they reach a service. */
export class ResourceIdPipe implements PipeTransform<string, string> {
  constructor(private readonly pattern: RegExp) {}

  transform(value: string): string {
    if (!this.pattern.test(value)) throw new BadRequestException("Invalid resource id");
    return value;
  }
}
