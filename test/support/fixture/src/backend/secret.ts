// Stands in for the subtree an app keeps queries and credentials in. Nothing
// here may ever be reachable over HTTP -- see LAUT-SRV-05.
export const DATABASE_URL = "postgres://fixture-must-never-be-served";
