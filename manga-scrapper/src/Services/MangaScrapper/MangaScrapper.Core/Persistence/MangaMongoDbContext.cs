using MangaScrapper.Core.Persistence.Documents;
using MongoDB.Driver;
using NovaStack.Infrastructure.Persistence.MongoDb;

namespace MangaScrapper.Core.Persistence;

public class MangaMongoDbContext : MongoDbContextBase
{
    public MangaMongoDbContext(IMongoClient client, string databaseName)
        : base(client, databaseName)
    {
    }

    public IMongoCollection<MangaDocument> Mangas => GetCollection<MangaDocument>("mangas");
    public IMongoCollection<UserDocument> Users => GetCollection<UserDocument>("users");
    public IMongoCollection<UserLibraryDocument> UserLibraries => GetCollection<UserLibraryDocument>("user_libraries");
    public IMongoCollection<UserProgressionDocument> UserProgressions => GetCollection<UserProgressionDocument>("user_progressions");
}
