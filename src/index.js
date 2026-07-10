import migrateAllShipments from './migrations/migrateAllShipments.js'

await migrateAllShipments({
	dryRun: false,
})
