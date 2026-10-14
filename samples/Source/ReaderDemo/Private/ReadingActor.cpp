// UE Reader sample. Original illustrative code, not Unreal Engine source.
// Open your engine source folder to start a real analysis.

#include "ReadingActor.h"
#include "Components/SceneComponent.h"

// Set the default state before the actor enters the world.
AReadingActor::AReadingActor()
{
    PrimaryActorTick.bCanEverTick = true;

    SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    SetRootComponent(SceneRoot);
}

// Called when this actor begins play.
void AReadingActor::BeginPlay()
{
    Super::BeginPlay();

    if (!IsValid(SceneRoot))
    {
        return;
    }

    bReady = true;
}

// Rotate a ready actor once per frame.
void AReadingActor::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    if (!bReady)
    {
        return;
    }

    const float DeltaYaw = RotationSpeed * DeltaSeconds;
    const FRotator DeltaRotation(0.0f, DeltaYaw, 0.0f);
    AddActorLocalRotation(DeltaRotation);
}

// Try selecting lines 34–41, then ask about the state and rotation.
