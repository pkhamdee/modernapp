// Types mirror sphone-api's catalog responses (GLOSSARY: Product Category, Product, Flat Rate, Term).

export interface ProductCategory {
  code: string
  name: string
  /** Monthly Flat Rate as a fraction: 0.015 = 1.5% per month. */
  flatRate: number
  /** Longest Term (number of monthly Installments) offered. */
  longestTerm: number
}

export interface ProductSummary {
  id: number
  name: string
  price: number
  productCategoryCode: string
  /** Lowest Installment offered with no Down Payment ("from ฿X / month"); null if no Term is offered. */
  fromInstallment: number | null
  /** Same-origin path of the Product photo (served by sphone-node-api under /images/public), or null. */
  imageUrl: string | null
}

export interface ProductDetail {
  id: number
  name: string
  description: string
  price: number
  productCategory: ProductCategory
  imageUrl: string | null
}

/** One offered Term. totalPayable = Down Payment + Installment × Term. */
export interface TermPlan {
  term: number
  installment: number
  totalPayable: number
}

export interface InstallmentPlans {
  price: number
  downPayment: number
  /** Only the Terms S Phone offers: capped by the Product Category, none under ฿500. */
  plans: TermPlan[]
}

export const catalogPaths = {
  productCategories: () => '/product-categories',
  productsInCategory: (code: string) => `/product-categories/${encodeURIComponent(code)}/products`,
  product: (id: string | number) => `/products/${encodeURIComponent(String(id))}`,
  installmentPlans: (id: string | number, downPayment: number) =>
    `/products/${encodeURIComponent(String(id))}/installment-plans?downPayment=${downPayment}`,
}
