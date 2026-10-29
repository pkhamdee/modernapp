import { Link, useParams } from 'react-router'
import { catalogPaths, type ProductDetail } from '../api/catalog.ts'
import { ApiError, useApi } from '../api/client.ts'
import { InstallmentCalculator } from '../components/InstallmentCalculator.tsx'
import { Status } from '../components/Status.tsx'
import { formatBaht, formatMonthlyRate } from '../format.ts'
import { NotFoundPage } from './NotFoundPage.tsx'

export function ProductPage() {
  const { id = '' } = useParams()
  const product = useApi<ProductDetail>(catalogPaths.product(id))

  if (product.status === 'error' && product.error instanceof ApiError && product.error.status === 404) {
    return <NotFoundPage />
  }
  if (product.status !== 'success') return <Status state={product} />

  const { name, description, price, productCategory } = product.data

  return (
    <article className="product-detail">
      <Link to={`/categories/${productCategory.code}`} className="back-link">
        ← {productCategory.name}
      </Link>
      <h1>{name}</h1>
      <p className="product-detail-price">{formatBaht(price)}</p>
      <p>{description}</p>
      <dl className="terms">
        <div>
          <dt>ดอกเบี้ยคงที่</dt>
          <dd>{formatMonthlyRate(productCategory.flatRate)} ต่อเดือน</dd>
        </div>
        <div>
          <dt>ผ่อนได้สูงสุด</dt>
          <dd>{productCategory.longestTerm} งวด</dd>
        </div>
      </dl>
      <InstallmentCalculator productId={product.data.id} price={price} />
    </article>
  )
}
