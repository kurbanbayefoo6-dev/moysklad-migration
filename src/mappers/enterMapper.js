import { employeeResolver } from '../resolvers/EmployeeResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	copyScalarFields,
	enterAttributeResolver,
	enterStateResolver,
	getRows,
	isObject,
	mapAssortmentPosition,
	mapAttributes,
	removeUndefined,
	resolveOptionalReference,
	resolveRequiredReference,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'moment',
	'applicable',
	'description',
	'externalCode',
]

async function mapEnterPosition(position, enter) {
	return mapAssortmentPosition(position, enter)
}

export class EnterMapper {
	async map(enter) {
		if (!isObject(enter)) {
			throw new Error('Enter payload is required')
		}

		const payload = {}
		copyScalarFields(payload, enter, SCALAR_FIELDS)

		payload.organization = await resolveRequiredReference(
			enter.organization,
			organizationResolver,
			'Enter organization',
			'Organization not found',
		)
		payload.store = await resolveRequiredReference(
			enter.store,
			warehouseResolver,
			'Enter warehouse',
			'Warehouse not found',
		)

		const owner = await resolveOptionalReference(
			enter.owner,
			employeeResolver,
			'Owner',
			'Owner not found',
		)
		if (owner) {
			payload.owner = owner
		}

		const project = await resolveOptionalReference(
			enter.project,
			projectResolver,
			'Project',
			'Project not found',
		)
		if (project) {
			payload.project = project
		}

		const state = await resolveOptionalReference(enter.state, enterStateResolver, 'State')
		if (state) {
			payload.state = state
		}

		const attributes = await mapAttributes(enter.attributes, enterAttributeResolver)
		if (attributes) {
			payload.attributes = attributes
		}

		payload.positions = await Promise.all(
			getRows(enter.positions).map(position => mapEnterPosition(position, enter)),
		)

		return removeUndefined(payload) || {}
	}
}

export const enterMapper = new EnterMapper()

export default enterMapper
