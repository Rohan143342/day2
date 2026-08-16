import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsentService } from '../consent/consent.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { QuoteRequestDto } from './dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly consent: ConsentService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List loan products currently offered, with the lender of record for each' })
  list() {
    return this.products.listAvailable();
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Server-computed quote: EMI, fees, taxes, APR, total repayment and full schedule',
    description:
      'The client must display these figures as returned and must not compute pricing itself. A quote is indicative until an offer is issued against a completed application.',
  })
  async quote(@CurrentUser() user: AuthenticatedUser, @Body() body: QuoteRequestDto) {
    // A quote is illustrative, but it still reveals product terms tied to the
    // customer's journey, so the required identity consent must already exist.
    await this.consent.assertGranted(user.userId, ['IDENTITY_VERIFICATION']);
    return this.products.quote(body);
  }
}
