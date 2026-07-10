import { BaseRepository } from './baseRepository.js'

function normalizeItems(response) {
	if (Array.isArray(response)) {
		return response
	}

	if (Array.isArray(response?.rows)) {
		return response.rows
	}

	if (Array.isArray(response?.items)) {
		return response.items
	}

	return []
}

export class ProductRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/product',
			...options,
		})
		this.lookupEndpoints = options.lookupEndpoints || [
			'entity/product',
			'entity/service',
		]
	}

	async findAllByEndpoint(endpoint, options = {}) {
		const client = this.resolveClient(options.client)
		const pageSize = options.pageSize || this.pageSize
		const products = []
		let offset = 0

		for (;;) {
			const response = await client.get(endpoint, {
				params: {
					...options.params,
					limit: pageSize,
					offset,
				},
			})
			const pageProducts = normalizeItems(response)
			products.push(...pageProducts)

			if (pageProducts.length < pageSize) {
				break
			}

			offset += pageSize
		}

		return products
	}

	async findAll(options = {}) {
		const products = []

		for (const endpoint of this.lookupEndpoints) {
			products.push(...(await this.findAllByEndpoint(endpoint, options)))
		}

		return products
	}

	async findByField(field, value, options = {}) {
		if (value === undefined || value === null || value === '') {
			return null
		}

		const client = this.resolveClient(options.client)

		for (const endpoint of this.lookupEndpoints) {
			const items = await this.paginate(client, {
				...options,
				endpoint,
				params: {
					...options.params,
					filter: `${field}=${value}`,
				},
			})

			if (items[0]) {
				return items[0]
			}
		}

		return null
	}

	findByArticle(article, options = {}) {
		return this.findByField('article', article, options)
	}
}

export const productRepository = new ProductRepository()

export default productRepository
