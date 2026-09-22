using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NovaStack.SharedKernel.Abstractions;

namespace NovaStack.Infrastructure.Persistence;

/// <summary>
/// Base DbContext that handles domain event dispatching via outbox pattern.
/// All service-specific DbContexts should inherit from this.
/// </summary>
public abstract class DbContextBase : DbContext
{
    protected DbContextBase(DbContextOptions options) : base(options) { }

    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    public override async Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        // Collect and serialize domain events from tracked entities into outbox messages
        var outboxMessages = new List<OutboxMessage>();

        foreach (var entry in ChangeTracker.Entries<IEntity>())
        {
            if (entry.Entity is not IHasDomainEvents hasDomainEvents) continue;

            var domainEvents = hasDomainEvents.GetDomainEvents();
            foreach (var domainEvent in domainEvents)
                outboxMessages.Add(OutboxMessage.Create(domainEvent));

            hasDomainEvents.ClearDomainEvents();
        }

        if (outboxMessages.Count > 0)
            await OutboxMessages.AddRangeAsync(outboxMessages, ct);

        return await base.SaveChangesAsync(ct);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(GetType().Assembly);
        modelBuilder.Entity<OutboxMessage>(b =>
        {
            b.ToTable("outbox_messages");
            b.HasKey(x => x.Id);
            b.Property(x => x.Type).HasMaxLength(500).IsRequired();
            b.Property(x => x.Payload).IsRequired();
        });

        base.OnModelCreating(modelBuilder);
    }
}
