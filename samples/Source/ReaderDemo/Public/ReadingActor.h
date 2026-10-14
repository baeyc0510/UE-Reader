// UE Reader sample. Original illustrative code, not Unreal Engine source.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ReadingActor.generated.h"

/** A small actor used to explore a component's lifecycle. */
UCLASS()
class AReadingActor : public AActor
{
    GENERATED_BODY()

public:
    AReadingActor();
    virtual void Tick(float DeltaSeconds) override;

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(EditAnywhere, Category = "Movement")
    float RotationSpeed = 45.0f;

    bool bReady = false;
};
