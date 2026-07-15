import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import { employeeResolver } from '../resolvers/EmployeeResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	cloneValue,
	copyScalarFields,
	getRows,
	isObject,
	mapAssortmentPosition,
	mapAttributes,
	moveAttributeResolver,
	moveStateResolver,
	removeUndefined,
	resolveOptionalReference,
	resolveRequiredReference,
	toMetaReference,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'name',
	'moment',
	'applicable',
	'description',
	'externalCode',
]

let oldGroups = null
let newGroups = null

function getReferenceHref(source) {
	return source?.meta?.href || source?.href || ''
}

function getReferenceId(source) {
	return (
		source?.id ||
		getReferenceHref(source).split('/').filter(Boolean).at(-1) ||
		''
	)
}

async function loadGroups(client) {
	const response = await client.get('entity/group', {
		params: {
			limit: 100,
			offset: 0,
		},
	})
	return getRows(response)
}

async function resolveGroup(group) {
	if (!group) {
		return null
	}

	if (!oldGroups) {
		oldGroups = await loadGroups(oldClient)
	}
	if (!newGroups) {
		newGroups = await loadGroups(newClient)
	}

	const href = getReferenceHref(group)
	const id = getReferenceId(group)
	const oldGroup =
		oldGroups.find(candidate => href && candidate?.meta?.href === href) ||
		oldGroups.find(candidate => id && candidate?.id === id) ||
		oldGroups.find(candidate => group?.name && candidate?.name === group.name)

	if (!oldGroup) {
		return null
	}

	const newGroup =
		newGroups.find(candidate => candidate?.name === oldGroup.name) ||
		newGroups.find(candidate => candidate?.index === oldGroup.index)

	return toMetaReference(newGroup)
}

async function mapMovePosition(position, move) {
	const mapped = await mapAssortmentPosition(position, move, ['reserve'])
	for (const field of ['quantity', 'price', 'reserve']) {
		if (position[field] !== undefined) {
			mapped[field] = cloneValue(position[field])
		}
	}
	return mapped
}

export class MoveMapper {
	async map(move) {
		if (!isObject(move)) {
			throw new Error('Move payload is required')
		}

		const payload = {}
		copyScalarFields(payload, move, SCALAR_FIELDS)

		payload.organization = await resolveRequiredReference(
			move.organization,
			organizationResolver,
			'Move organization',
			'Organization not found',
		)
		payload.sourceStore = await resolveRequiredReference(
			move.sourceStore,
			warehouseResolver,
			'Move source warehouse',
			'Source warehouse not found',
		)
		payload.targetStore = await resolveRequiredReference(
			move.targetStore,
			warehouseResolver,
			'Move target warehouse',
			'Target warehouse not found',
		)

		const owner = await resolveOptionalReference(
			move.owner,
			employeeResolver,
			'Owner',
			'Owner not found',
		)
		if (owner) {
			payload.owner = owner
		}

		const group = await resolveGroup(move.group)
		if (group) {
			payload.group = group
		}

		const project = await resolveOptionalReference(
			move.project,
			projectResolver,
			'Project',
			'Project not found',
		)
		if (project) {
			payload.project = project
		}

		const state = await resolveOptionalReference(move.state, moveStateResolver, 'State')
		if (state) {
			payload.state = state
		}

		const attributes = await mapAttributes(move.attributes, moveAttributeResolver)
		if (attributes) {
			payload.attributes = attributes
		}

		payload.positions = await Promise.all(
			getRows(move.positions).map(position => mapMovePosition(position, move)),
		)

		return removeUndefined(payload) || {}
	}
}

export const moveMapper = new MoveMapper()

export default moveMapper
