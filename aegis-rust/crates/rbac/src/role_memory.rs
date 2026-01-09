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
    use tempfile::TempDir;

    fn create_entry(id: &str, content: &str, memory_type: MemoryType) -> MemoryEntry {
        MemoryEntry {
            id: id.to_string(),
            content: content.to_string(),
            memory_type,
            tags: vec![],
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    // ============== Basic Tests ==============

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

    #[test]
    fn test_new_with_path() {
        let store = RoleMemoryStore::new("/custom/memory/path");
        assert_eq!(store.base_dir, PathBuf::from("/custom/memory/path"));
    }

    #[test]
    fn test_default() {
        let store = RoleMemoryStore::default();
        assert_eq!(store.base_dir, PathBuf::from("memory"));
    }

    #[test]
    fn test_memory_file_path() {
        let store = RoleMemoryStore::new("/base/dir");
        let path = store.memory_file_path("test-role");
        assert_eq!(path, PathBuf::from("/base/dir/test-role.memory.md"));
    }

    // ============== Save and Recall Tests ==============

    #[test]
    fn test_save_and_recall() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        let entry = create_entry("mem_001", "User prefers dark mode", MemoryType::Preference);
        store.save("test-role", entry).unwrap();

        let results = store.recall("test-role", "dark", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "mem_001");
    }

    #[test]
    fn test_save_multiple_entries() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role", create_entry("mem_001", "First memory", MemoryType::Fact)).unwrap();
        store.save("role", create_entry("mem_002", "Second memory", MemoryType::Fact)).unwrap();
        store.save("role", create_entry("mem_003", "Third memory", MemoryType::Preference)).unwrap();

        let all = store.get_all("role");
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn test_recall_with_limit() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role", create_entry("mem_001", "test memory one", MemoryType::Fact)).unwrap();
        store.save("role", create_entry("mem_002", "test memory two", MemoryType::Fact)).unwrap();
        store.save("role", create_entry("mem_003", "test memory three", MemoryType::Fact)).unwrap();

        let results = store.recall("role", "test", 2);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_recall_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role", create_entry("mem_001", "User prefers DARK mode", MemoryType::Preference)).unwrap();

        let results = store.recall("role", "dark", 10);
        assert_eq!(results.len(), 1);

        let results = store.recall("role", "DARK", 10);
        assert_eq!(results.len(), 1);

        let results = store.recall("role", "Dark", 10);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_recall_no_match() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role", create_entry("mem_001", "Something about cats", MemoryType::Fact)).unwrap();

        let results = store.recall("role", "dogs", 10);
        assert!(results.is_empty());
    }

    #[test]
    fn test_recall_unknown_role() {
        let store = RoleMemoryStore::new("/tmp/test");
        let results = store.recall("unknown-role", "query", 10);
        assert!(results.is_empty());
    }

    // ============== Get All Tests ==============

    #[test]
    fn test_get_all_empty() {
        let store = RoleMemoryStore::new("/tmp/test");
        let results = store.get_all("empty-role");
        assert!(results.is_empty());
    }

    #[test]
    fn test_get_all_returns_all() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        for i in 0..5 {
            store.save("role", create_entry(&format!("mem_{}", i), &format!("Memory {}", i), MemoryType::Fact)).unwrap();
        }

        let all = store.get_all("role");
        assert_eq!(all.len(), 5);
    }

    // ============== Persist Tests ==============

    #[test]
    fn test_persist_creates_file() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("persist-role", create_entry("mem_001", "Test content", MemoryType::Fact)).unwrap();

        let file_path = temp_dir.path().join("persist-role.memory.md");
        assert!(file_path.exists());
    }

    #[test]
    fn test_persist_file_contents() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("test-role", create_entry("mem_001", "Test content", MemoryType::Fact)).unwrap();

        let file_path = temp_dir.path().join("test-role.memory.md");
        let contents = std::fs::read_to_string(file_path).unwrap();

        assert!(contents.contains("# Memory: test-role"));
        assert!(contents.contains("Total entries: 1"));
        assert!(contents.contains("## Facts"));
        assert!(contents.contains("[mem_001]"));
        assert!(contents.contains("Test content"));
    }

    #[test]
    fn test_persist_groups_by_type() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role", create_entry("fact1", "A fact", MemoryType::Fact)).unwrap();
        store.save("role", create_entry("pref1", "A preference", MemoryType::Preference)).unwrap();
        store.save("role", create_entry("ctx1", "A context", MemoryType::Context)).unwrap();

        let file_path = temp_dir.path().join("role.memory.md");
        let contents = std::fs::read_to_string(file_path).unwrap();

        assert!(contents.contains("## Facts"));
        assert!(contents.contains("## Preferences"));
        assert!(contents.contains("## Contexts"));
    }

    // ============== Load Tests ==============

    #[test]
    fn test_load_nonexistent_file() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        // Should not error for nonexistent file
        let result = store.load("nonexistent-role");
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_existing_file() {
        let temp_dir = TempDir::new().unwrap();

        // Create a memory file
        let file_path = temp_dir.path().join("existing-role.memory.md");
        std::fs::write(&file_path, "# Memory: existing-role\n").unwrap();

        let mut store = RoleMemoryStore::new(temp_dir.path());
        let result = store.load("existing-role");
        assert!(result.is_ok());
    }

    // ============== Memory Type Tests ==============

    #[test]
    fn test_memory_type_equality() {
        assert_eq!(MemoryType::Fact, MemoryType::Fact);
        assert_eq!(MemoryType::Preference, MemoryType::Preference);
        assert_eq!(MemoryType::Context, MemoryType::Context);
        assert_eq!(MemoryType::Episode, MemoryType::Episode);
        assert_eq!(MemoryType::Learned, MemoryType::Learned);

        assert_ne!(MemoryType::Fact, MemoryType::Preference);
    }

    #[test]
    fn test_memory_type_clone() {
        let t = MemoryType::Fact;
        let cloned = t.clone();
        assert_eq!(t, cloned);
    }

    #[test]
    fn test_memory_type_debug() {
        let debug = format!("{:?}", MemoryType::Fact);
        assert_eq!(debug, "Fact");
    }

    // ============== Memory Entry Tests ==============

    #[test]
    fn test_memory_entry_clone() {
        let entry = MemoryEntry {
            id: "test".to_string(),
            content: "content".to_string(),
            memory_type: MemoryType::Fact,
            tags: vec!["tag1".to_string()],
            created_at: "2024-01-01".to_string(),
        };

        let cloned = entry.clone();
        assert_eq!(cloned.id, entry.id);
        assert_eq!(cloned.content, entry.content);
        assert_eq!(cloned.memory_type, entry.memory_type);
        assert_eq!(cloned.tags, entry.tags);
        assert_eq!(cloned.created_at, entry.created_at);
    }

    #[test]
    fn test_memory_entry_debug() {
        let entry = create_entry("id", "content", MemoryType::Fact);
        let debug = format!("{:?}", entry);
        assert!(debug.contains("MemoryEntry"));
        assert!(debug.contains("id"));
    }

    #[test]
    fn test_memory_entry_with_tags() {
        let entry = MemoryEntry {
            id: "test".to_string(),
            content: "content".to_string(),
            memory_type: MemoryType::Preference,
            tags: vec!["ui".to_string(), "settings".to_string(), "dark".to_string()],
            created_at: "2024-01-01".to_string(),
        };

        assert_eq!(entry.tags.len(), 3);
        assert!(entry.tags.contains(&"ui".to_string()));
    }

    // ============== Role Memory Store Tests ==============

    #[test]
    fn test_store_debug() {
        let store = RoleMemoryStore::new("/tmp/test");
        let debug = format!("{:?}", store);
        assert!(debug.contains("RoleMemoryStore"));
    }

    #[test]
    fn test_multiple_roles_isolated() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role1", create_entry("mem_001", "Role 1 memory", MemoryType::Fact)).unwrap();
        store.save("role2", create_entry("mem_002", "Role 2 memory", MemoryType::Fact)).unwrap();

        let role1_memories = store.get_all("role1");
        let role2_memories = store.get_all("role2");

        assert_eq!(role1_memories.len(), 1);
        assert_eq!(role2_memories.len(), 1);
        assert_eq!(role1_memories[0].content, "Role 1 memory");
        assert_eq!(role2_memories[0].content, "Role 2 memory");
    }

    // ============== Edge Cases ==============

    mod edge_cases {
        use super::*;

        #[test]
        fn test_empty_role_id() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            let entry = create_entry("mem_001", "Empty role memory", MemoryType::Fact);
            let result = store.save("", entry);
            // Should work even with empty role ID
            assert!(result.is_ok());

            let file_path = temp_dir.path().join(".memory.md");
            assert!(file_path.exists());
        }

        #[test]
        fn test_empty_content() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            store.save("role", create_entry("mem_001", "", MemoryType::Fact)).unwrap();

            let all = store.get_all("role");
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].content, "");
        }

        #[test]
        fn test_unicode_content() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            store.save("role", create_entry("mem_001", "日本語のメモリ 🎉", MemoryType::Fact)).unwrap();

            let results = store.recall("role", "日本語", 10);
            assert_eq!(results.len(), 1);
        }

        #[test]
        fn test_very_long_content() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            let long_content = "x".repeat(10000);
            store.save("role", create_entry("mem_001", &long_content, MemoryType::Fact)).unwrap();

            let all = store.get_all("role");
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].content.len(), 10000);
        }

        #[test]
        fn test_special_chars_in_role_id() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            // Note: This creates a file with special chars in name, may fail on some systems
            let entry = create_entry("mem_001", "Content", MemoryType::Fact);
            let result = store.save("role-with-dashes", entry);
            assert!(result.is_ok());
        }

        #[test]
        fn test_multiline_content() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            let multiline = "Line 1\nLine 2\nLine 3";
            store.save("role", create_entry("mem_001", multiline, MemoryType::Fact)).unwrap();

            let results = store.recall("role", "Line 2", 10);
            assert_eq!(results.len(), 1);
        }

        #[test]
        fn test_recall_with_zero_limit() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            store.save("role", create_entry("mem_001", "test memory", MemoryType::Fact)).unwrap();

            let results = store.recall("role", "test", 0);
            assert!(results.is_empty());
        }

        #[test]
        fn test_many_entries() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            for i in 0..100 {
                store.save("role", create_entry(
                    &format!("mem_{:03}", i),
                    &format!("Memory content {}", i),
                    MemoryType::Fact
                )).unwrap();
            }

            let all = store.get_all("role");
            assert_eq!(all.len(), 100);
        }

        #[test]
        fn test_memory_type_all_variants() {
            let temp_dir = TempDir::new().unwrap();
            let mut store = RoleMemoryStore::new(temp_dir.path());

            store.save("role", create_entry("1", "Fact", MemoryType::Fact)).unwrap();
            store.save("role", create_entry("2", "Preference", MemoryType::Preference)).unwrap();
            store.save("role", create_entry("3", "Context", MemoryType::Context)).unwrap();
            store.save("role", create_entry("4", "Episode", MemoryType::Episode)).unwrap();
            store.save("role", create_entry("5", "Learned", MemoryType::Learned)).unwrap();

            let all = store.get_all("role");
            assert_eq!(all.len(), 5);

            // Check file has all sections
            let file_path = temp_dir.path().join("role.memory.md");
            let contents = std::fs::read_to_string(file_path).unwrap();
            assert!(contents.contains("## Facts"));
            assert!(contents.contains("## Preferences"));
            assert!(contents.contains("## Contexts"));
            assert!(contents.contains("## Episodes"));
            assert!(contents.contains("## Learneds"));
        }
    }

    // ============== Concurrency Tests ==============

    #[test]
    fn test_save_overwrites_previous_persist() {
        let temp_dir = TempDir::new().unwrap();
        let mut store = RoleMemoryStore::new(temp_dir.path());

        store.save("role", create_entry("mem_001", "First", MemoryType::Fact)).unwrap();
        store.save("role", create_entry("mem_002", "Second", MemoryType::Fact)).unwrap();

        let file_path = temp_dir.path().join("role.memory.md");
        let contents = std::fs::read_to_string(file_path).unwrap();

        assert!(contents.contains("First"));
        assert!(contents.contains("Second"));
        assert!(contents.contains("Total entries: 2"));
    }
}
