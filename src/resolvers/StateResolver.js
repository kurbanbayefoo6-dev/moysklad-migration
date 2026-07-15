import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'

const DEFAULT_METADATA_ENDPOINT = 'entity/demand/metadata'

function getReferenceHref(source) {
	return source?.meta?.href || source?.href || ''
}

function getReferenceId(source) {
	const href = getReferenceHref(source)
	return source?.id || href.split('/').filter(Boolean).at(-1) || ''
}

function normalizeName(value) {
	return String(value ?? '').trim().toLowerCase()
}

function extractMeta(entity) {
	return entity?.meta
		? {
				href: entity.meta.href,
				type: entity.meta.type,
				mediaType: entity.meta.mediaType,
			}
		: null
}

export class StateResolver {
	constructor({
		oldStateClient = oldClient,
		newStateClient = newClient,
		metadataEndpoint = DEFAULT_METADATA_ENDPOINT,
	} = {}) {
		this.oldStateClient = oldStateClient
		this.newStateClient = newStateClient
		this.metadataEndpoint = metadataEndpoint
		this.oldStates = null
		this.newStates = null
		this.oldStatesPending = null
		this.newStatesPending = null
	}

	async loadStates(client) {
		const response = await client.get(this.metadataEndpoint)
		return Array.isArray(response?.states) ? response.states : []
	}

	async getOldStates() {
		if (this.oldStates) {
			return this.oldStates
		}

		if (!this.oldStatesPending) {
			this.oldStatesPending = this.loadStates(this.oldStateClient)
		}

		this.oldStates = await this.oldStatesPending
		this.oldStatesPending = null
		return this.oldStates
	}

	async getNewStates() {
		if (this.newStates) {
			return this.newStates
		}

		if (!this.newStatesPending) {
			this.newStatesPending = this.loadStates(this.newStateClient)
		}

		this.newStates = await this.newStatesPending
		this.newStatesPending = null
		return this.newStates
	}

	async resolve(source) {
		if (!source) {
			return null
		}

		const oldStates = await this.getOldStates()
		const sourceHref = getReferenceHref(source)
		const sourceId = getReferenceId(source)
		const oldState =
			oldStates.find(state => sourceHref && state?.meta?.href === sourceHref) ||
			oldStates.find(state => sourceId && state?.id === sourceId) ||
			oldStates.find(state => source?.name && state?.name === source.name)

		if (!oldState?.name) {
			return null
		}

		const newStates = await this.getNewStates()
		const newState =
			newStates.find(state => state?.name === oldState.name) ||
			newStates.find(
				state => normalizeName(state?.name) === normalizeName(oldState.name),
			)
		const meta = extractMeta(newState)
		return meta ? { meta } : null
	}
}

export const stateResolver = new StateResolver()

export default stateResolver
