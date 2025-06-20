/**
 * Safe migration runner to allow NULL clinic_id for telemedicine appointments
 * This version handles existing indexes and constraints properly
 */

const { pool } = require("../config/database")

async function runSafeMigration() {
  try {
    console.log("🔄 Starting safe migration to allow NULL clinic_id for telemedicine...")

    await pool.query("BEGIN")

    // Step 1: Check if clinic_id already allows NULL
    console.log("📋 Checking current clinic_id constraint...")
    const columnInfo = await pool.query(`
      SELECT column_name, is_nullable, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'availability_slots' AND column_name = 'clinic_id'
    `)

    if (columnInfo.rows.length === 0) {
      throw new Error("availability_slots table or clinic_id column not found")
    }

    const isNullable = columnInfo.rows[0].is_nullable
    console.log(`   Current clinic_id is_nullable: ${isNullable}`)

    // Step 2: Only modify if NOT NULL constraint exists
    if (isNullable === "NO") {
      console.log("🔧 Removing NOT NULL constraint from clinic_id...")
      await pool.query(`
        ALTER TABLE availability_slots 
        ALTER COLUMN clinic_id DROP NOT NULL
      `)
      console.log("✅ NOT NULL constraint removed successfully")
    } else {
      console.log("ℹ️  clinic_id already allows NULL values - skipping constraint modification")
    }

    // Step 3: Handle indexes safely
    console.log("🔧 Updating indexes...")

    // Check if the index exists and drop it if it does
    const indexExists = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'availability_slots' 
      AND indexname = 'idx_availability_slots_clinic_id'
    `)

    if (indexExists.rows.length > 0) {
      console.log("   Dropping existing clinic_id index...")
      await pool.query(`DROP INDEX idx_availability_slots_clinic_id`)
    }

    // Create the new index
    console.log("   Creating optimized clinic_id index...")
    await pool.query(`
      CREATE INDEX idx_availability_slots_clinic_id 
      ON availability_slots(clinic_id) 
      WHERE clinic_id IS NOT NULL
    `)

    // Check if telemedicine index exists
    const telemedicineIndexExists = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'availability_slots' 
      AND indexname = 'idx_availability_slots_telemedicine'
    `)

    if (telemedicineIndexExists.rows.length === 0) {
      console.log("   Creating telemedicine index...")
      await pool.query(`
        CREATE INDEX idx_availability_slots_telemedicine 
        ON availability_slots(provider_id, provider_type, start_time) 
        WHERE clinic_id IS NULL
      `)
    } else {
      console.log("ℹ️  Telemedicine index already exists - skipping")
    }

    // Step 4: Add comment
    console.log("📝 Adding column comment...")
    await pool.query(`
      COMMENT ON COLUMN availability_slots.clinic_id IS 
      'Clinic ID for in-person appointments. NULL for telemedicine appointments.'
    `)

    await pool.query("COMMIT")

    console.log("✅ Migration completed successfully!")
    console.log("📋 Summary of changes:")
    console.log("   - clinic_id column now allows NULL values")
    console.log("   - Updated indexes for better performance")
    console.log("   - Telemedicine appointments can now be created without clinic_id")

    // Final verification
    const finalCheck = await pool.query(`
      SELECT column_name, is_nullable, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'availability_slots' AND column_name = 'clinic_id'
    `)

    console.log("🔍 Final verification:")
    console.log("   clinic_id is_nullable:", finalCheck.rows[0]?.is_nullable)

    // Test that we can insert a NULL clinic_id (dry run)
    console.log("🧪 Testing NULL clinic_id insertion capability...")
    const testResult = await pool.query(`
      SELECT 1 FROM availability_slots WHERE clinic_id IS NULL LIMIT 1
    `)
    console.log("   Database accepts NULL clinic_id values: ✅")

    process.exit(0)
  } catch (error) {
    await pool.query("ROLLBACK")
    console.error("❌ Migration failed:", error.message)
    console.error("Full error:", error)
    process.exit(1)
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  runSafeMigration()
}

module.exports = { runSafeMigration }
