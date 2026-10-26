import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(8)
  // bcrypt only consumes the first 72 bytes; reject longer secrets outright.
  @MaxLength(72)
  password!: string;
}
