import { HttpStatus, Injectable } from '@nestjs/common';
import { LoanProductVersion, ProductStatus } from '@prisma/client';
import { Money, buildQuote } from '@lending/money';
import { AppException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProductOption {
  productVersionId: string;
  productCode: string;
  productName: string;
  lender: { legalName: string; brandName: string; licenseType: string; licenseReference: string };
  minAmount: string;
  maxAmount: string;
  minTenureMonths: number;
  maxTenureMonths: number;
  annualRatePercent: string;
  interestMethodology: string;
  processingFeePercent: string;
  taxOnFeesPercent: string;
  coolingOffDays: number;
}

export interface QuoteView {
  productVersionId: string;
  /** The regulated lender of record must be identifiable on every disclosure. */
  lender: { legalName: string; brandName: string; licenseType: string; licenseReference: string };
  amount: string;
  tenureMonths: number;
  annualRatePercent: string;
  interestMethodology: string;
  emi: string;
  processingFee: string;
  taxOnFee: string;
  netDisbursed: string;
  totalInterest: string;
  totalCostOfCredit: string;
  totalPayable: string;
  aprPercent: string;
  feeCollection: string;
  coolingOffDays: number;
  allocationOrder: string[];
  schedule: Array<{
    installmentNumber: number;
    dueDate: string;
    principalDue: string;
    interestDue: string;
    totalDue: string;
    closingPrincipal: string;
  }>;
}

/**
 * Pricing is read from the immutable product version and computed by
 * `@lending/money`. Nothing in this service knows a rate, a fee or a tax rate:
 * changing pricing is a data change made through product approval, never a code
 * change, and a live loan keeps the version it was originated under.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(): Promise<ProductOption[]> {
    const now = new Date();
    const versions = await this.prisma.loanProductVersion.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        product: { lender: { status: 'ACTIVE' } },
      },
      include: { product: { include: { lender: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return versions.map((version) => ({
      productVersionId: version.id,
      productCode: version.product.code,
      productName: version.product.name,
      lender: {
        legalName: version.product.lender.legalName,
        brandName: version.product.lender.brandName,
        licenseType: version.product.lender.licenseType,
        licenseReference: version.product.lender.licenseReference,
      },
      minAmount: version.minAmount.toFixed(2),
      maxAmount: version.maxAmount.toFixed(2),
      minTenureMonths: version.minTenureMonths,
      maxTenureMonths: version.maxTenureMonths,
      annualRatePercent: version.annualRatePercent.toFixed(4),
      interestMethodology: version.interestMethodology,
      processingFeePercent: version.processingFeePercent.toFixed(4),
      taxOnFeesPercent: version.taxOnFeesPercent.toFixed(4),
      coolingOffDays: version.coolingOffDays,
    }));
  }

  async quote(params: { productVersionId: string; amount: string; tenureMonths: number }): Promise<QuoteView> {
    const version = await this.prisma.loanProductVersion.findUnique({
      where: { id: params.productVersionId },
      include: { product: { include: { lender: true } } },
    });
    if (!version) {
      throw new AppException(ErrorCode.NOT_FOUND, 'That loan product is not available.', HttpStatus.NOT_FOUND);
    }
    this.assertOffereable(version);

    const amount = Money.fromMajor(params.amount);
    if (amount.lessThan(Money.fromMajor(version.minAmount.toString()))) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `The minimum amount for this product is ₹${version.minAmount.toFixed(2)}.`,
      );
    }
    if (amount.greaterThan(Money.fromMajor(version.maxAmount.toString()))) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `The maximum amount for this product is ₹${version.maxAmount.toFixed(2)}.`,
      );
    }
    if (params.tenureMonths < version.minTenureMonths || params.tenureMonths > version.maxTenureMonths) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `Tenure must be between ${version.minTenureMonths} and ${version.maxTenureMonths} months.`,
      );
    }

    const firstDueDate = new Date();
    firstDueDate.setMonth(firstDueDate.getMonth() + 1);

    const quote = buildQuote({
      principal: amount,
      annualRatePercent: version.annualRatePercent.toString(),
      tenureMonths: params.tenureMonths,
      methodology: version.interestMethodology,
      firstDueDate,
      fees: {
        processingFeePercent: version.processingFeePercent.toString(),
        processingFeeMin: version.processingFeeMin ? Money.fromMajor(version.processingFeeMin.toString()) : undefined,
        processingFeeMax: version.processingFeeMax ? Money.fromMajor(version.processingFeeMax.toString()) : undefined,
        taxOnFeesPercent: version.taxOnFeesPercent.toString(),
        feeCollection: version.feeCollection,
      },
    });

    return {
      productVersionId: version.id,
      lender: {
        legalName: version.product.lender.legalName,
        brandName: version.product.lender.brandName,
        licenseType: version.product.lender.licenseType,
        licenseReference: version.product.lender.licenseReference,
      },
      amount: amount.toMajorString(),
      tenureMonths: params.tenureMonths,
      annualRatePercent: version.annualRatePercent.toFixed(4),
      interestMethodology: version.interestMethodology,
      emi: quote.emi.toMajorString(),
      processingFee: quote.processingFee.toMajorString(),
      taxOnFee: quote.taxOnFee.toMajorString(),
      netDisbursed: quote.netDisbursed.toMajorString(),
      totalInterest: quote.totalInterest.toMajorString(),
      totalCostOfCredit: quote.totalCostOfCredit.toMajorString(),
      totalPayable: quote.totalPayable.toMajorString(),
      // APR is on the net amount actually received, so upfront deductions are
      // reflected in the headline cost rather than hidden in the fee line.
      aprPercent: quote.apr.nominalAnnualPercent.toDecimalPlaces(4).toString(),
      feeCollection: version.feeCollection,
      coolingOffDays: version.coolingOffDays,
      allocationOrder: version.allocationOrder,
      schedule: quote.schedule.installments.map((installment) => ({
        installmentNumber: installment.installmentNumber,
        dueDate: installment.dueDate.toISOString().slice(0, 10),
        principalDue: installment.principalDue.toMajorString(),
        interestDue: installment.interestDue.toMajorString(),
        totalDue: installment.totalDue.toMajorString(),
        closingPrincipal: installment.closingPrincipal.toMajorString(),
      })),
    };
  }

  private assertOffereable(version: LoanProductVersion & { product: { lender: { status: string } } }): void {
    const now = new Date();
    const withdrawn = version.effectiveTo !== null && version.effectiveTo <= now;
    if (
      version.status !== ProductStatus.ACTIVE ||
      version.effectiveFrom > now ||
      withdrawn ||
      version.product.lender.status !== 'ACTIVE'
    ) {
      // A DRAFT product, a future-dated version or an inactive lender must never
      // produce a quote: a quote implies an offer a lender is willing to honour.
      throw new AppException(ErrorCode.NOT_FOUND, 'That loan product is not available.', HttpStatus.NOT_FOUND);
    }
  }
}
