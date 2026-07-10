import { currencyRepository } from '../repositories/currencyRepository.js'
import { BaseResolver, EntityNotFoundError } from './BaseResolver.js'

function getReferenceHref(source) {
	return source?.meta?.href || source?.href || ''
}

function getReferenceId(source) {
	const href = getReferenceHref(source)
	return source?.id || href.split('/').filter(Boolean).at(-1) || ''
}

function getCurrencyCode(source) {
	return source?.code || source?.isoCode || source?.name || ''
}

export class CurrencyResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Currency',
			repository: options.repository || currencyRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'code',
					getValue: source => getCurrencyCode(source),
					method: 'findByCode',
				},
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
		this.oldCurrencies = null
		this.oldCurrenciesPending = null
	}

	async getOldCurrencies(options = {}) {
		if (this.oldCurrencies) {
			return this.oldCurrencies
		}

		if (!this.oldCurrenciesPending) {
			this.oldCurrenciesPending = this.repository.findAll({
				...options,
				client: 'old',
			})
		}

		this.oldCurrencies = await this.oldCurrenciesPending
		this.oldCurrenciesPending = null
		return this.oldCurrencies
	}

	async resolveOldReference(source, options = {}) {
		const href = getReferenceHref(source)
		const id = getReferenceId(source)
		const oldCurrencies = await this.getOldCurrencies(options)
		const oldCurrency =
			oldCurrencies.find(currency => href && currency?.meta?.href === href) ||
			oldCurrencies.find(currency => id && currency?.id === id) ||
			source

		return this.resolveOrDefault(oldCurrency, options)
	}

	async getDefaultCurrency(options = {}) {
		const context = { ...options, client: options.client || this.client }
		const currencies = await this.getEntities(context)
		return (
			currencies.find(currency => currency.default) ||
			currencies.find(currency => !currency.archived) ||
			currencies[0] ||
			null
		)
	}

	async resolveOrDefault(source, options = {}) {
		try {
			return await this.resolve(source, options)
		} catch (error) {
			if (!(error instanceof EntityNotFoundError)) {
				throw error
			}

			const defaultCurrency = await this.getDefaultCurrency(options)
			return defaultCurrency?.meta ? { meta: defaultCurrency.meta } : null
		}
	}
}

export const currencyResolver = new CurrencyResolver()

export default currencyResolver
