//! RoleMemoryStore - Transparent Markdown-based memory system per role

use std::collections::HashMap;
use std::path::PathBuf;

/// Memory entry type
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryType {
    Fact,
    Preference,
    Context,
    Episode,
    Learned,
}

/// A single memory entry
#[derive(Debug, Clone)]
pub struct MemoryEntry {
    pub id: String,
    pub content: String,
    pub memory_type: MemoryType,
    pub tags: Vec<String>,
    pub created_at: String,
}

/// Role-based memory store
#[derive(Debug)]
pub struct RoleMemoryStore {
    /// Base directory for memory files
    base_dir: PathBuf,
    /// In-memory cache (role_id -> memories)
    cache: HashMap<String, Vec<MemoryEntry>>,
}

impl RoleMemoryStore {
    /// Create a new RoleMemoryStore
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
            cache: HashMap::new(),
        }
    }

    /// Get the file path for a role's memory
    pub fn memory_file_path(&self, role_id: &str) -> PathBuf {
        self.base_dir.join(format!("{}.memory.md", role_id))
    }

    /// Save a memory entry for a role
    pub fn save(&mut self, role_id: &str, entry: MemoryEntry) -> std::io::Result<()> {
        let entries = self.cache.entry(role_id.to_string()).or_default();
        entries.push(entry);
        self.persist(role_id)
    }

    /// Recall memories by query
    pub fn recall(&self, role_id: &str, query: &str, limit: usize) -> Vec<&MemoryEntry> {
        let query_lower = query.to_lowercase();

        self.cache
            .get(role_id)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|e| e.content.to_lowercase().contains(&query_lower))
                    .take(limit)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all memories for a role
    pub fn get_all(&self, role_id: &str) -> Vec<&MemoryEntry> {
        self.cache
            .get(role_id)
            .map(|entries| entries.iter().collect())
            .unwrap_or_default()
    }

    /// Persist memories to disk
    fn persist(&self, role_id: &str) -> std::io::Result<()> {
        let path = self.memory_file_path(role_id);

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let entries = match self.cache.get(role_id) {
            Some(e) => e,
            None => return Ok(()),
        };

        let mut content = format!("# Memory: {}\n\n", role_id);
        content.push_str(&format!("> Total entries: {}\n\n", entries.len()));

        // Group by type
        for memory_type in [
            MemoryType::Fact,
            MemoryType::Preference,
            MemoryType::Context,
            MemoryType::Episode,
            MemoryType::Learned,
        ] {
            let type_entries: Vec<_> = entries.iter().filter(|e| e.memory_type == memory_type).collect();

            if !type_entries.is_empty() {
                content.push_str(&format!("## {:?}s\n\n", memory_type));

                for entry in type_entries {
                    content.push_str(&format!("### [{}]\n", entry.id));
                    content.push_str(&entry.content);
                    content.push_str("\n\n");
                }
            }
        }

        std::fs::write(path, content)
    }

    /// Load memories from disk
    pub fn load(&mut self, role_id: &str) -> std::io::Result<()> {
        let path = self.memory_file_path(role_id);

        if !path.exists() {
            return Ok(());
        }

        // TODO: Parse markdown and load entries
        // For now, just create empty cache entry
        self.cache.entry(role_id.to_string()).or_default();

        Ok(())
    }
}

impl Default for RoleMemoryStore {
    fn default() -> Self {
        Self::new("memory")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_store() {
        let mut store = RoleMemoryStore::new("/tmp/aegis-test-memory");

        let entry = MemoryEntry {
            id: "mem_001".to_string(),
            content: "User prefers dark mode".to_string(),
            memory_type: MemoryType::Preference,
            tags: vec!["ui".to_string()],
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        store.cache.entry("test".to_string()).or_default().push(entry);

        let results = store.recall("test", "dark", 10);
        assert_eq!(results.len(), 1);
    }
}
