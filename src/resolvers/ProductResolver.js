import { productRepository } from '../repositories/productRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class ProductResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Product',
			repository: options.repository || productRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'externalCode',
					field: 'externalCode',
					method: 'findByExternalCode',
				},
				{ name: 'code', field: 'code', method: 'findByCode' },
				{
					name: 'article',
					field: 'article',
					lookup: (repository, value, context) =>
						repository.findByField('article', value, context),
				},
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}
}

export const productResolver = new ProductResolver()

export default productResolver
