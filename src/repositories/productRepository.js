import { BaseRepository } from './baseRepository.js'

export class ProductRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/product',
			...options,
		})
	}
}

export const productRepository = new ProductRepository()

export default productRepository
