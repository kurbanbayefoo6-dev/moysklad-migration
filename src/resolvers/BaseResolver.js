const DEFAULT_CLIENT = 'new'

function normalizeValue(value) {
	if (value === undefined || value === null) {
		return ''
	}

	return String(value).trim()
}

function extractMeta(entity) {
	if (!entity?.meta) {
		return null
	}

	const { href, type, mediaType } = entity.meta
	if (!href || !type || !mediaType) {
		return null
	}

	return { href, type, mediaType }
}

export class ResolverError extends Error {
	constructor(message) {
		super(message)
		this.name = 'ResolverError'
	}
}

export class EntityNotFoundError extends ResolverError {
	constructor(entityName) {
		super(`${entityName} not found`)
		this.name = 'EntityNotFoundError'
		this.entityName = entityName
	}
}

export class BaseResolver {
	constructor({ entityName, repository, strategies, client = DEFAULT_CLIENT }) {
		if (!entityName) {
			throw new Error('Resolver entity name is required')
		}

		if (!repository) {
			throw new Error('Resolver repository is required')
		}

		this.entityName = entityName
		this.repository = repository
		this.strategies = strategies || []
		this.client = client
		this.cache = new Map()
		this.pending = new Map()
		this.entityLists = new Map()
		this.entityListPending = new Map()
		this.strategyIndexes = new Map()
	}

	createCacheKey(strategyName, value) {
		return `${strategyName}:${normalizeValue(value)}`
	}

	getStrategyValue(strategy, source) {
		if (typeof strategy.getValue === 'function') {
			return strategy.getValue(source)
		}

		if (strategy.field) {
			return source?.[strategy.field]
		}

		return undefined
	}

	async lookupStrategy(strategy, value, options) {
		if (typeof strategy.lookup === 'function') {
			return strategy.lookup(this.repository, value, options)
		}

		if (
			!strategy.method ||
			typeof this.repository[strategy.method] !== 'function'
		) {
			throw new ResolverError(
				`Unsupported lookup method for ${this.entityName}`,
			)
		}

		return this.repository[strategy.method](value, options)
	}

	getClientCacheKey(options) {
		return options.client || this.client
	}

	async getEntities(options) {
		const clientCacheKey = this.getClientCacheKey(options)
		if (this.entityLists.has(clientCacheKey)) {
			return this.entityLists.get(clientCacheKey)
		}

		if (this.entityListPending.has(clientCacheKey)) {
			return this.entityListPending.get(clientCacheKey)
		}

		const pendingEntities = this.repository.findAll(options)
		this.entityListPending.set(clientCacheKey, pendingEntities)

		try {
			const entities = await pendingEntities
			this.entityLists.set(clientCacheKey, entities)
			return entities
		} finally {
			this.entityListPending.delete(clientCacheKey)
		}
	}

	getEntityFieldValue(entity, strategy) {
		if (strategy.field) {
			return entity?.[strategy.field]
		}

		if (typeof strategy.getValue === 'function') {
			return strategy.getValue(entity)
		}

		return undefined
	}

	async getStrategyIndex(strategy, options) {
		const clientCacheKey = this.getClientCacheKey(options)
		const indexKey = `${clientCacheKey}:${strategy.name}`
		if (this.strategyIndexes.has(indexKey)) {
			return this.strategyIndexes.get(indexKey)
		}

		const entities = await this.getEntities(options)
		const index = new Map()

		for (const entity of entities) {
			const value = this.getEntityFieldValue(entity, strategy)
			const normalizedValue = normalizeValue(value)
			if (!normalizedValue) {
				continue
			}

			if (!index.has(normalizedValue)) {
				index.set(normalizedValue, entity)
			}
		}

		this.strategyIndexes.set(indexKey, index)
		return index
	}

	async lookupCachedStrategy(strategy, value, options) {
		const index = await this.getStrategyIndex(strategy, options)
		return index.get(normalizeValue(value)) || null
	}

	cacheMeta(source, meta) {
		for (const strategy of this.strategies) {
			const value = this.getStrategyValue(strategy, source)
			const normalizedValue = normalizeValue(value)
			if (!normalizedValue) {
				continue
			}

			this.cache.set(this.createCacheKey(strategy.name, normalizedValue), meta)
		}
	}

	invalidateCache(value, strategyName) {
		if (strategyName) {
			this.cache.delete(this.createCacheKey(strategyName, value))
			return
		}

		const normalizedValue = normalizeValue(value)
		for (const key of this.cache.keys()) {
			if (key.endsWith(`:${normalizedValue}`)) {
				this.cache.delete(key)
			}
		}
	}

	clearCache() {
		this.cache.clear()
		this.pending.clear()
		this.entityLists.clear()
		this.entityListPending.clear()
		this.strategyIndexes.clear()
	}

	async resolve(source, options = {}) {
		const context = { ...options, client: options.client || this.client }

		for (const strategy of this.strategies) {
			const value = this.getStrategyValue(strategy, source)
			const normalizedValue = normalizeValue(value)
			if (!normalizedValue) {
				continue
			}

			const cacheKey = this.createCacheKey(strategy.name, normalizedValue)
			if (this.cache.has(cacheKey)) {
				return { meta: this.cache.get(cacheKey) }
			}

			if (this.pending.has(cacheKey)) {
				return { meta: await this.pending.get(cacheKey) }
			}

			const pendingResolution = (async () => {
				const entity = await this.lookupCachedStrategy(
					strategy,
					normalizedValue,
					context,
				)
				const meta = extractMeta(entity)
				if (!meta) {
					return null
				}

				this.cacheMeta(source, meta)
				return meta
			})()

			this.pending.set(cacheKey, pendingResolution)

			try {
				const meta = await pendingResolution
				if (meta) {
					return { meta }
				}
			} finally {
				this.pending.delete(cacheKey)
			}
		}

		throw new EntityNotFoundError(this.entityName)
	}

	async resolveMany(items, options = {}) {
		return Promise.all(items.map(item => this.resolve(item, options)))
	}
}
