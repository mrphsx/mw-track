import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class ScenarioAbTestWeightDto {
  @IsString()
  scenarioId: string;

  @IsInt()
  @Min(0)
  weight: number;
}

export class UpdateScenarioAbTestWeightsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ScenarioAbTestWeightDto)
  weights: ScenarioAbTestWeightDto[];
}
