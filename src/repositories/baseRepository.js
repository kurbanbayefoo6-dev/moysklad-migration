import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'

const DEFAULT_PAGE_SIZE = 100

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

export class BaseRepository {
	constructor({
		endpoint,
		pageSize = DEFAULT_PAGE_SIZE,
		readClient = oldClient,
		writeClient = newClient,
	}) {
		if (!endpoint) {
			throw new Error('Repository endpoint is required')
		}

		this.endpoint = endpoint
		this.pageSize = pageSize
		this.readClient = readClient
		this.writeClient = writeClient
	}

	resolveClient(client) {
		if (client === 'new') {
			return this.writeClient
		}

		if (client === 'old') {
			return this.readClient
		}

		return client || this.readClient
	}

	buildUrl(path = '') {
		return path ? `${this.endpoint}/${path}` : this.endpoint
	}

	async paginate(
		client,
		{ endpoint = this.endpoint, params = {}, pageSize = this.pageSize } = {},
	) {
		const items = []
		let offset = 0
		let total

		for (;;) {
			const response = await client.get(endpoint, {
				params: {
					...params,
					limit: pageSize,
					offset,
				},
			})

			const pageItems = normalizeItems(response)
			items.push(...pageItems)

			if (typeof response?.meta?.size === 'number') {
				total = response.meta.size
			}

			if (typeof total === 'number' && items.length >= total) {
				break
			}

			const nextOffset = offset + pageSize
			if (
				pageItems.length < pageSize &&
				(typeof total !== 'number' || nextOffset >= total)
			) {
				break
			}

			offset = nextOffset
		}

		return items
	}

	async findAll(options = {}) {
		const client = this.resolveClient(options.client)
		return this.paginate(client, options)
	}

	async findById(id, options = {}) {
		if (!id) {
			throw new Error('Entity id is required')
		}

		const client = this.resolveClient(options.client)
		return client.get(this.buildUrl(id), { params: options.params })
	}

	async findByField(field, value, options = {}) {
		if (value === undefined || value === null || value === '') {
			return null
		}

		const client = this.resolveClient(options.client)
		const items = await this.paginate(client, {
			...options,
			params: {
				...options.params,
				filter: `${field}=${value}`,
			},
		})

		return items[0] || null
	}

	findByCode(code, options = {}) {
		return this.findByField('code', code, options)
	}

	findByName(name, options = {}) {
		return this.findByField('name', name, options)
	}

	findByExternalCode(externalCode, options = {}) {
		return this.findByField('externalCode', externalCode, options)
	}

	async create(data, options = {}) {
		const client = this.resolveClient(options.client || 'new')
		return client.post(this.endpoint, data, { params: options.params })
	}

	async update(id, data, options = {}) {
		if (!id) {
			throw new Error('Entity id is required')
		}

		const client = this.resolveClient(options.client || 'new')
		return client.put(this.buildUrl(id), data, { params: options.params })
	}

	async delete(id, options = {}) {
		if (!id) {
			throw new Error('Entity id is required')
		}

		const client = this.resolveClient(options.client || 'new')
		return client.delete(this.buildUrl(id), { params: options.params })
	}
}
